/**
 * Pure, side-effect-free subagent (Claude Code Task) detection for the PTY
 * output stream the status engine already consumes.
 *
 * Claude Code renders a subagent invocation as a Task tool block: a header line
 * like `● Task(Explore the codebase)` (the label is the `subagent_type` /
 * description it chose to print) followed by a `⎿ Running…` / `⎿ Done (…)` /
 * error status line. We recognize those markers in ANSI-stripped text and
 * classify each as running / done / failed. Only ONE level is observable — a
 * parent terminal never renders a subagent's own subagents (they run in an
 * isolated context), matching the intent's `session → subagent` model.
 *
 * Like `statusParser`, this module is deterministic, holds no module-level
 * mutable state, and performs no I/O, timers, or `Date.now`. It MUST DEGRADE
 * GRACEFULLY: plain-shell / non-Claude output and ANSI noise yield no
 * observations and never throw. Accumulation, attribution, and store writes
 * live in `subagentEngine`; this module only classifies the text it is handed.
 *
 * This is the primary place future Task render styles get added — keep the
 * regex set small and well-commented.
 */

/** Coarse render state of a Task block, as seen in the terminal. */
export type TaskState = "running" | "done" | "failed";

/** One Task observation parsed from a chunk of (already ANSI-stripped) output. */
export interface TaskObservation {
  /** The label printed in the Task header, or `"subagent"` when none is shown. */
  label: string;
  /** The render state derived from the Task's status line (or the header alone). */
  state: TaskState;
}

/**
 * Strip common ANSI escape sequences (CSI sequences such as colour/SGR codes,
 * cursor moves, and erase/clear) so pattern matching works on the heavily
 * styled output Claude Code's TUI emits. Mirrors `statusParser.stripAnsi`.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b[PX^_].*?\x1b\\/g, "");
}

/**
 * A Task header line: a bullet (●, optional/stripped) then `Task(` … `)`. The
 * captured group is the label; we tolerate the closing paren being absent (the
 * line may be wrapped/clipped). Anchored to a line start after optional
 * whitespace so the word "Task" mid-sentence does not fire.
 */
const TASK_HEADER = /^[ \t]*(?:[●○*▪►-]\s*)?Task\s*\(([^)\n]*)\)?/im;

/**
 * Task status lines. The `⎿` tree-branch glyph is optional/stripped, so we key
 * off the status word itself, anchored after optional leading whitespace and
 * branch glyphs. Ordered failure → done → running so a failure wins.
 */
const TASK_FAILED = /^[ \t]*(?:[⎿└├│]\s*)?(?:error\b|failed\b|✗|✘|×)/im;
const TASK_DONE = /^[ \t]*(?:[⎿└├│]\s*)?(?:done\b|completed\b|✓|✔)/im;
const TASK_RUNNING = /^[ \t]*(?:[⎿└├│]\s*)?(?:running|working|in progress)\b/im;

/** Trim and normalize a captured Task label; empty → the generic `"subagent"`. */
function normalizeLabel(raw: string | undefined): string {
  const label = (raw ?? "").trim();
  return label.length > 0 ? label : "subagent";
}

/**
 * Classify the status line(s) that follow a Task header within `tail`. The tail
 * is the slice of output from just after the header onward; we look at it for a
 * failure/done/running marker before the NEXT Task header (so one Task's status
 * never leaks onto another). Defaults to `running` — a Task that has been
 * announced but not yet resolved is live.
 */
function classifyState(tail: string): TaskState {
  // Bound the window to this Task's block: stop at the next Task header.
  const nextHeader = tail.search(/^[ \t]*(?:[●○*▪►-]\s*)?Task\s*\(/im);
  const block = nextHeader >= 0 ? tail.slice(0, nextHeader) : tail;
  if (TASK_FAILED.test(block)) return "failed";
  if (TASK_DONE.test(block)) return "done";
  if (TASK_RUNNING.test(block)) return "running";
  return "running";
}

/**
 * Parse all Task observations from a chunk of output (typically a bounded
 * trailing buffer). Returns observations in render order; an empty array for
 * plain-shell / unknown output. Never throws.
 *
 * Each header yields exactly one observation; its state comes from the status
 * line(s) between this header and the next. Because the engine works on a
 * trailing buffer, the SAME Task header reappears as long as it stays in the
 * tail, carrying its latest status — the engine reconciles those by render
 * order (see `subagentEngine`).
 */
export function parseSubagents(text: string): TaskObservation[] {
  if (!text) {
    return [];
  }
  const clean = stripAnsi(text);
  const observations: TaskObservation[] = [];

  // Walk every Task header in order, slicing the remainder of the buffer to
  // classify the block that follows each one.
  const headerScan = new RegExp(TASK_HEADER.source, "gim");
  let match: RegExpExecArray | null;
  while ((match = headerScan.exec(clean)) !== null) {
    const label = normalizeLabel(match[1]);
    const afterHeader = clean.slice(match.index + match[0].length);
    observations.push({ label, state: classifyState(afterHeader) });
    // Guard against a zero-width match looping forever.
    if (match.index === headerScan.lastIndex) {
      headerScan.lastIndex += 1;
    }
  }

  return observations;
}
