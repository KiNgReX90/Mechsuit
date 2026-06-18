/**
 * Live terminal pool.
 *
 * One xterm.js instance per session, kept ALIVE for the session's whole life —
 * independent of which workspace is mounted. The single `<Workspace>` only
 * renders the selected directory's panes, so switching directories unmounts the
 * others; if each unmount disposed its xterm, returning would rebuild an empty
 * terminal (scrollback gone, blank until new output) and tiles would visibly
 * "glitch". Instead the React `<Terminal>` acquires its instance here and merely
 * RELEASES (detaches the DOM) on unmount. The instance — and its output
 * subscription — stay live in the background, so re-showing a workspace
 * re-attaches the exact same terminal with full scrollback and zero flicker.
 *
 * The instance is torn down only by `disposeTerminal`, called when the session
 * is closed for good (see `sessionsStore.removeSession`).
 */
import "@xterm/xterm/css/xterm.css";

import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { resizeSession, writeSession } from "../ipc/commands";
import { onSessionOutput } from "../ipc/events";
import { useStatusStore } from "../state/statusStore";

/** Handle to a session's live terminal, returned by {@link acquireTerminal}. */
export interface TerminalPane {
  readonly sessionId: string;
  /** Fit the terminal to its current container and resize the PTY to match. */
  fit(): void;
  /** Move keyboard (DOM) focus onto this terminal's input surface. */
  focus(): void;
}

interface PoolEntry {
  term: XTerm;
  fitAddon: FitAddon;
  /** GPU/2D canvas renderer for the VISIBLE pane. Loaded on acquire (the surface
   *  is attached to a laid-out, visible container) and disposed on release — the
   *  xterm instance itself is NOT disposed, so scrollback survives the detach.
   *  Undefined while detached; re-created on the next acquire. */
  canvasAddon: CanvasAddon | undefined;
  /** The element xterm renders into; re-parented across attach/detach, so it
   *  (and the rendered scrollback inside it) survives a workspace switch. */
  surface: HTMLDivElement;
  dataDisposable: { dispose: () => void };
  /** Output chunks received since the last flush, in arrival order. They are
   *  concatenated and written in one `term.write()` per animation frame; the
   *  Rust reader already aligns chunks on UTF-8 boundaries, so joining strings
   *  never re-splits a multi-byte sequence. */
  pending: string;
  /** Handle for the scheduled per-frame flush, or undefined when none is armed. */
  flushHandle: number | undefined;
  pane: TerminalPane;
}

// Per-frame flush scheduler. The browser coalesces a burst of small output
// chunks into one paint by deferring the `term.write()` to the next animation
// frame. The scheduler is indirected through a swappable pair so it stays
// deterministic under test: real `requestAnimationFrame` when present, a
// microtask fallback otherwise (and tests install a microtask scheduler so a
// flushed `await Promise.resolve()` drives a frame — see `__setFlushScheduler`).
type FlushScheduler = {
  schedule: (cb: () => void) => number;
  cancel: (handle: number) => void;
};

const microtaskScheduler: FlushScheduler = {
  schedule: (cb) => {
    queueMicrotask(cb);
    return 0;
  },
  cancel: () => {},
};

function defaultScheduler(): FlushScheduler {
  if (typeof requestAnimationFrame === "function") {
    return {
      schedule: (cb) => requestAnimationFrame(cb),
      cancel: (h) =>
        typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(h) : undefined,
    };
  }
  return microtaskScheduler;
}

let flushScheduler: FlushScheduler = defaultScheduler();

const scheduleFlush = (cb: () => void): number => flushScheduler.schedule(cb);
const cancelFlush = (handle: number): void => flushScheduler.cancel(handle);

/** TEST ONLY. Swap the per-frame flush scheduler so tests can drive flushes
 *  deterministically (e.g. a microtask scheduler) regardless of whether the
 *  jsdom environment provides a timer-backed `requestAnimationFrame`. Pass no
 *  argument to restore the environment default. */
export function __setFlushScheduler(scheduler?: FlushScheduler): void {
  flushScheduler = scheduler ?? defaultScheduler();
}

/** Concatenate the buffered chunks and write them in one go, clearing the buffer
 *  and the armed frame. Safe to call eagerly (e.g. on dispose). */
function flushEntry(entry: PoolEntry): void {
  if (entry.flushHandle !== undefined) {
    cancelFlush(entry.flushHandle);
    entry.flushHandle = undefined;
  }
  if (entry.pending.length === 0) return;
  const data = entry.pending;
  entry.pending = "";
  entry.term.write(data);
}

// The app's "command deck" palette, so panes blend into their tiles instead of
// being stark black rectangles.
const TERMINAL_THEME = {
  background: "#0a0d13",
  foreground: "#e8edf6",
  cursor: "#5b8cff",
  cursorAccent: "#0a0d13",
  selectionBackground: "rgba(91, 140, 255, 0.35)",
  black: "#0a0d13",
  brightBlack: "#3a455c",
  red: "#f76d6d",
  brightRed: "#ff8a8a",
  green: "#3fb950",
  brightGreen: "#56d364",
  yellow: "#e3a13a",
  brightYellow: "#f0c060",
  blue: "#5b8cff",
  brightBlue: "#79a2ff",
  magenta: "#bb87ff",
  brightMagenta: "#d2a8ff",
  cyan: "#2fe0c8",
  brightCyan: "#6ff0dd",
  white: "#c8d2e0",
  brightWhite: "#e8edf6",
} as const;

const pool = new Map<string, PoolEntry>();

// A SINGLE `session://output` subscription feeds the whole pool. Each output
// event carries its `sessionId`, so one listener routes the chunk to the right
// entry via an O(1) map lookup. Registering one listener per terminal instead
// would fan every chunk out to all N panes (each filtering by id), making
// per-chunk cost grow with the number of open terminals — the dominant lag
// source when many panes stream at once. The subscription lives only while at
// least one terminal exists: the first acquire arms it, emptying the pool tears
// it down (so a later acquire arms a fresh one).
let outputUnlisten: UnlistenFn | undefined;
let outputSubscribed = false;

function ensureOutputSubscription(): void {
  if (outputSubscribed) return;
  outputSubscribed = true;
  void onSessionOutput((payload) => {
    // Route by id, then buffer instead of writing immediately. A burst of small
    // chunks for one session is concatenated (in arrival order) and written once
    // on the next animation frame, instead of one synchronous `term.write()` per
    // event — the dominant main-thread cost when many panes stream at once.
    const entry = pool.get(payload.sessionId);
    if (!entry) return;
    entry.pending += payload.data;
    if (entry.flushHandle === undefined) {
      entry.flushHandle = scheduleFlush(() => {
        entry.flushHandle = undefined;
        flushEntry(entry);
      });
    }
  }).then((fn) => {
    // The pool may have emptied before this promise resolved; if so, tear the
    // subscription down immediately rather than leaking it.
    if (outputSubscribed) outputUnlisten = fn;
    else fn();
  });
}

function teardownOutputSubscriptionIfIdle(): void {
  if (pool.size > 0) return;
  outputSubscribed = false;
  outputUnlisten?.();
  outputUnlisten = undefined;
}

/** Load the canvas renderer onto a visible pane's xterm, once. The renderer is
 *  only meaningful while the surface is attached to a laid-out container, so it
 *  is created on acquire and disposed on release; re-acquire re-creates it. */
function attachRenderer(entry: PoolEntry): void {
  if (entry.canvasAddon) return;
  const canvasAddon = new CanvasAddon();
  entry.term.loadAddon(canvasAddon);
  entry.canvasAddon = canvasAddon;
}

/** Dispose the canvas renderer (if attached) WITHOUT touching the xterm instance,
 *  so scrollback survives a detach. No-op when already detached. */
function detachRenderer(entry: PoolEntry): void {
  entry.canvasAddon?.dispose();
  entry.canvasAddon = undefined;
}

function createEntry(sessionId: string, container: HTMLElement): PoolEntry {
  const surface = document.createElement("div");
  surface.className = "terminal-pane-surface";
  // Attach BEFORE open so xterm can measure a laid-out element.
  container.appendChild(surface);

  const term = new XTerm({
    fontFamily:
      '"JetBrains Mono", "SF Mono", ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: TERMINAL_THEME,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(surface);

  // Forward user keystrokes to the PTY. A carriage return means the user
  // submitted a prompt/command, so arm a re-alert: the session's NEXT ready
  // transition will blink even if it was already acknowledged. Incidental input
  // (plain chars, focus-tracking escapes) carries no CR, so it never re-arms.
  const dataDisposable = term.onData((data) => {
    if (data.includes("\r")) {
      useStatusStore.getState().markPrompted(sessionId);
    }
    void writeSession(sessionId, data);
  });

  const entry: PoolEntry = {
    term,
    fitAddon,
    canvasAddon: undefined,
    surface,
    dataDisposable,
    pending: "",
    flushHandle: undefined,
    pane: {
      sessionId,
      fit() {
        fitAddon.fit();
        void resizeSession(sessionId, term.cols, term.rows);
      },
      focus() {
        term.focus();
      },
    },
  };

  // Output streams in through the pool's single shared subscription (see
  // `ensureOutputSubscription`), routed here by sessionId — the instance keeps
  // receiving even while detached (hidden behind another workspace), so the
  // pane is always current the instant it is re-shown.

  // xterm measures the glyph cell at open() time; if the bundled JetBrains Mono
  // webfont hadn't decoded yet, that used the fallback metrics. Re-fit once
  // fonts are ready so cell size matches the real font (no half-row clipping or
  // mis-sized columns on first paint). Guarded for jsdom, where `fonts` is absent.
  if (typeof document !== "undefined" && document.fonts?.ready) {
    void document.fonts.ready.then(() => entry.pane.fit());
  }

  return entry;
}

/**
 * Acquire the live terminal for `sessionId`, mounting its surface into
 * `container`. Builds the xterm instance on first use; thereafter re-attaches
 * the surviving instance (scrollback intact). Callers must {@link releaseTerminal}
 * on unmount.
 */
export function acquireTerminal(sessionId: string, container: HTMLElement): TerminalPane {
  ensureOutputSubscription();
  let entry = pool.get(sessionId);
  if (!entry) {
    entry = createEntry(sessionId, container);
    pool.set(sessionId, entry);
  } else if (entry.surface.parentElement !== container) {
    container.appendChild(entry.surface);
  }
  // The pane is now (or already) attached to a visible container, so load the
  // fast canvas renderer. Idempotent: re-acquiring an already-attached pane does
  // not stack a second renderer.
  attachRenderer(entry);
  return entry.pane;
}

/**
 * Move keyboard (DOM) focus onto a session's terminal, if it is in the pool.
 * Used to keep DOM focus in lockstep with the app's focused-session selection,
 * so keystrokes are never routed to (or swallowed by) the wrong pane.
 */
export function focusTerminal(sessionId: string): void {
  pool.get(sessionId)?.term.focus();
}

/**
 * Detach a session's terminal from the DOM WITHOUT destroying it. The xterm
 * instance and its output subscription stay alive, so the pane keeps rendering
 * in the background and re-attaches instantly with full scrollback.
 */
export function releaseTerminal(sessionId: string): void {
  const entry = pool.get(sessionId);
  if (!entry) return;
  // Dispose the canvas renderer now that the pane is detached (a hidden pane
  // needs no GPU/2D renderer), but leave the xterm instance and its scrollback
  // intact so re-acquire re-shows it instantly.
  detachRenderer(entry);
  entry.surface.remove();
}

/**
 * Fully tear down a session's terminal — called when the session is closed for
 * good. Disposes xterm and the input handler, then drops the entry so a later
 * acquire builds a fresh instance. The pool's shared output subscription is
 * released only when this empties the pool.
 */
export function disposeTerminal(sessionId: string): void {
  const entry = pool.get(sessionId);
  if (!entry) return;
  pool.delete(sessionId);
  // Flush any output buffered for the as-yet-unfired frame before tearing the
  // instance down (and cancel the frame), so no bytes are lost and no rAF
  // callback fires after disposal.
  flushEntry(entry);
  detachRenderer(entry);
  entry.dataDisposable.dispose();
  entry.term.dispose();
  entry.surface.remove();
  // Drop the shared output subscription once the last terminal is gone.
  teardownOutputSubscriptionIfIdle();
}
