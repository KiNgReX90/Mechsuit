import type { SessionStatus } from '../types';

/**
 * Pure, side-effect-free output heuristics used by the status engine.
 *
 * These functions classify the trailing output of a PTY session. They are
 * deterministic, hold no module-level mutable state, and perform no I/O,
 * timers, or `Date.now`. The idle/quiet debounce and exit-code handling live
 * in the separate status-engine item — this module only classifies the text
 * it is handed.
 *
 * Heuristics must DEGRADE GRACEFULLY for unknown agents / plain shells: when
 * in doubt, never emit a false `awaiting-approval`.
 *
 * This is the primary place future agents' prompt styles get added — keep the
 * regex set small and well-commented.
 */

/**
 * Strip common ANSI escape sequences (CSI sequences such as colour/SGR codes,
 * cursor moves, and erase/clear) so pattern matching works on agent CLIs that
 * emit heavily styled output.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[PX^_].*?\x1b\\/g, '');
}

/**
 * Approval-prompt detectors. Each is matched against ANSI-stripped text.
 * Ordered Claude Code first, then generic confirmation styles.
 */
const APPROVAL_PATTERNS: RegExp[] = [
  // Claude Code numbered choice menus: "❯ 1. Yes" / "1. Yes" with a paired
  // "2. No" (the leading ❯ caret and styling are optional/stripped).
  /^\s*(?:❯\s*)?1\.\s*yes\b/im,
  // Explicit "Do you want to proceed?" style confirmations.
  /\bdo you want to (?:proceed|continue)\b/i,
  // Generic yes/no confirmations: (y/n), [Y/n], (yes/no) — possibly trailing
  // a question, optionally followed by a prompt colon/question mark.
  /[([]\s*y(?:es)?\s*\/\s*n(?:o)?\s*[)\]]/i,
];

/**
 * True when the trailing output looks like an interactive approval prompt
 * awaiting the user's confirmation. Case-insensitive where sensible. Returns
 * `false` for plain-shell output and unknown/garbage input.
 */
export function matchesApprovalPrompt(text: string): boolean {
  if (!text) {
    return false;
  }
  const clean = stripAnsi(text);
  return APPROVAL_PATTERNS.some((re) => re.test(clean));
}

/**
 * Error-signature detectors. Anchored to line starts (with optional leading
 * whitespace) where possible so the word "error" appearing incidentally
 * mid-sentence does not fire.
 */
const ERROR_PATTERNS: RegExp[] = [
  // "Error:" / "error:" at the start of a line (after optional whitespace).
  /^\s*error:/im,
  // Git-style fatal errors.
  /^\s*fatal:/im,
  // Shell: "<cmd>: command not found".
  /\bcommand not found\b/i,
  // Runtime panics (Go, Rust, etc.).
  /\bpanic\b/i,
  // Python tracebacks.
  /Traceback \(most recent call last\)/,
];

/**
 * True when the trailing output contains a known error signature. Avoids
 * firing on the bare word "error" appearing mid-sentence by anchoring the
 * `error:` form to line starts. Returns `false` for empty/garbage input.
 */
export function matchesError(text: string): boolean {
  if (!text) {
    return false;
  }
  const clean = stripAnsi(text);
  return ERROR_PATTERNS.some((re) => re.test(clean));
}

/**
 * Classify the trailing output of a session that has gone idle/quiet.
 * Returns `"awaiting-approval"` when an approval prompt is detected, otherwise
 * `"ready"`. Never throws on empty or garbage input. Error classification is
 * intentionally NOT done here (it comes from exit codes / `matchesError` in
 * the engine).
 */
export function classifyIdle(trailingText: string): SessionStatus {
  return matchesApprovalPrompt(trailingText) ? 'awaiting-approval' : 'ready';
}
