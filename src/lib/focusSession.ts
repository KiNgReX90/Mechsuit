/**
 * Switch input focus to a session — the one routine both a tile click and
 * Shift+Arrow navigation go through, so the "clear screen + select + grab DOM
 * focus" dance lives in exactly one place.
 *
 * When switching INTO a different, live (non-paused) session it sends Ctrl+L
 * (`\f`) so the running program redraws a clean screen — matching the tile
 * click. Re-focusing the already-focused session skips the clear (so cursor
 * placement / selection survive); a paused session is SIGSTOPped, so a clear
 * would only queue to wipe its frozen screen on resume.
 */
import { writeSession } from "../ipc/commands";
import { focusTerminal } from "./terminalPool";
import { usePausedStore } from "../state/pausedStore";
import { useUiStore } from "../state/uiStore";

// Ctrl+L (form feed, 0x0C). Carries no carriage return, so the pool reads it as
// incidental input and never re-arms the prompt re-alert.
const CLEAR_SCREEN = "\f";

export interface FocusSessionOptions {
  /** Also expand this session to fill the workspace (expanded-mode switch). */
  expand?: boolean;
  /**
   * Whether switching in should send Ctrl+L to redraw a clean screen (default
   * true, matching a tile click). Set false to only re-route input without
   * disturbing the pane — e.g. when a workspace switch adopts one of its own
   * sessions for focus rather than the user deliberately entering it.
   */
  clear?: boolean;
}

export function focusSession(
  sessionId: string,
  options: FocusSessionOptions = {},
): void {
  const ui = useUiStore.getState();
  const isSwitching = ui.focusedSessionId !== sessionId;
  const isPaused = usePausedStore.getState().pausedIds.has(sessionId);

  if (isSwitching && !isPaused && options.clear !== false) {
    void writeSession(sessionId, CLEAR_SCREEN);
  }
  ui.setFocusedSessionId(sessionId);
  if (options.expand) ui.setExpandedSessionId(sessionId);
  // Pull DOM focus onto the terminal even when the trigger was a keypress or a
  // click on tile chrome rather than the xterm textarea itself.
  focusTerminal(sessionId);
}
