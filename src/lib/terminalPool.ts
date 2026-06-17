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
}

interface PoolEntry {
  term: XTerm;
  fitAddon: FitAddon;
  /** The element xterm renders into; re-parented across attach/detach, so it
   *  (and the rendered scrollback inside it) survives a workspace switch. */
  surface: HTMLDivElement;
  dataDisposable: { dispose: () => void };
  unlisten?: UnlistenFn;
  /** Set once {@link disposeTerminal} runs, so a still-pending output
   *  subscription tears itself down when it resolves. */
  disposed: boolean;
  pane: TerminalPane;
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
    surface,
    dataDisposable,
    disposed: false,
    pane: {
      sessionId,
      fit() {
        fitAddon.fit();
        void resizeSession(sessionId, term.cols, term.rows);
      },
    },
  };

  // Stream output destined for THIS session for the instance's whole life —
  // including while detached (hidden behind another workspace) — so the pane is
  // always current the instant it is re-shown.
  void onSessionOutput((payload) => {
    if (payload.sessionId === sessionId) {
      entry.term.write(payload.data);
    }
  }).then((fn) => {
    if (entry.disposed) fn();
    else entry.unlisten = fn;
  });

  return entry;
}

/**
 * Acquire the live terminal for `sessionId`, mounting its surface into
 * `container`. Builds the xterm instance on first use; thereafter re-attaches
 * the surviving instance (scrollback intact). Callers must {@link releaseTerminal}
 * on unmount.
 */
export function acquireTerminal(sessionId: string, container: HTMLElement): TerminalPane {
  let entry = pool.get(sessionId);
  if (!entry) {
    entry = createEntry(sessionId, container);
    pool.set(sessionId, entry);
  } else if (entry.surface.parentElement !== container) {
    container.appendChild(entry.surface);
  }
  return entry.pane;
}

/**
 * Detach a session's terminal from the DOM WITHOUT destroying it. The xterm
 * instance and its output subscription stay alive, so the pane keeps rendering
 * in the background and re-attaches instantly with full scrollback.
 */
export function releaseTerminal(sessionId: string): void {
  pool.get(sessionId)?.surface.remove();
}

/**
 * Fully tear down a session's terminal — called when the session is closed for
 * good. Disposes xterm, the input handler, and the output subscription, then
 * drops the entry so a later acquire builds a fresh instance.
 */
export function disposeTerminal(sessionId: string): void {
  const entry = pool.get(sessionId);
  if (!entry) return;
  pool.delete(sessionId);
  entry.disposed = true;
  entry.dataDisposable.dispose();
  entry.unlisten?.();
  entry.term.dispose();
  entry.surface.remove();
}
