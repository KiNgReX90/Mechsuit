/**
 * Tiled session grid.
 *
 * Arranges the selected directory's sessions into a top-row-heavy grid using
 * `computeGridLayout(n).rows` (1 = full, 4 = 2×2, 5 = 3/2, 9 = 5/4), composing
 * one `<Terminal>` per tile. Clicking a tile focuses it (`focusedSessionId`);
 * an expand control on each tile sets `expandedSessionId` to fill the
 * workspace. Only the focused tile forwards keyboard input — non-focused tiles
 * swallow keydown events at the capture phase so their Terminal never sees them.
 */
import { Terminal } from "../Terminal";
import type { SessionInfo, SessionStatusState } from "../../types";
import { computeGridLayout } from "../../lib/gridLayout";
import { useStatusStore } from "../../state/statusStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { usePausedStore } from "../../state/pausedStore";
import { setSessionPaused, writeSession } from "../../ipc/commands";
import { focusTerminal } from "../../lib/terminalPool";
import { SessionActions } from "./SessionActions";

// Ctrl+L (form feed, 0x0C). Sent to a session's PTY when you switch INTO it so
// the running program (shell / Claude Code) clears its screen — a clean view on
// every focus change. It carries no carriage return, so it reads as incidental
// input and never re-arms the pool's prompt re-alert.
const CLEAR_SCREEN = "\f";

/**
 * Map a session's status record to a tile status class. Returns null for the
 * neutral default (no entry or `working`). A `ready` session blinks green to
 * alert until acknowledged — either by the engine's blink window elapsing or the
 * user focusing it — after which it clears back to neutral (no status color), so
 * a finished tile never lingers green. FOCUS WINS: callers must drop this class
 * entirely for the focused tile so it never also carries a status color.
 */
export function tileStatusClass(record: SessionStatusState | undefined): string | null {
  if (!record) return null;
  switch (record.status) {
    case "ready":
      return record.acknowledged ? null : "workspace-tile--ready";
    case "awaiting-approval":
      return "workspace-tile--awaiting-approval";
    case "error":
      return "workspace-tile--error";
    case "working":
    default:
      return null;
  }
}

export interface GridProps {
  sessions: SessionInfo[];
  focusedSessionId: string | null;
  onFocus: (sessionId: string) => void;
  onExpand: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}

export function Grid({
  sessions,
  focusedSessionId,
  onFocus,
  onExpand,
  onClose,
}: GridProps) {
  const statusBySession = useStatusStore((s) => s.statusBySession);
  const namesBySession = useSessionsStore((s) => s.namesBySession);
  const pausedIds = usePausedStore((s) => s.pausedIds);
  const { rows } = computeGridLayout(sessions.length);

  // Walk the layout rows, slicing sessions into each row in order.
  let cursor = 0;
  const rowSlices = rows.map((count) => {
    const slice = sessions.slice(cursor, cursor + count);
    cursor += count;
    return slice;
  });

  return (
    <div className="workspace-grid" data-testid="workspace-grid">
      {rowSlices.map((rowSessions, rowIndex) => (
        <div
          className="workspace-grid-row"
          data-testid="workspace-grid-row"
          key={rowIndex}
        >
          {rowSessions.map((session) => {
            const isFocused = session.id === focusedSessionId;
            const isPaused = pausedIds.has(session.id);
            // FOCUS WINS: a focused tile shows only the accent border, never a
            // status color; status still lives in the store for other readers.
            const statusClass = isFocused
              ? null
              : tileStatusClass(statusBySession[session.id]);
            const className = [
              "workspace-tile",
              isFocused ? "workspace-tile--focused" : null,
              statusClass,
              isPaused ? "workspace-tile--paused" : null,
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                className={className}
                data-testid="workspace-tile"
                data-session-id={session.id}
                data-focused={isFocused ? "true" : "false"}
                key={session.id}
                onClick={() => {
                  // Switching INTO an unfocused, live tile clears its screen
                  // (Ctrl+L). Re-clicking the focused tile is a no-op so cursor
                  // placement / text selection still work; a paused tile is
                  // SIGSTOPped, so a clear would only queue to wipe its frozen
                  // screen on resume.
                  if (!isFocused && !isPaused) {
                    void writeSession(session.id, CLEAR_SCREEN);
                  }
                  onFocus(session.id);
                  // Pull DOM focus onto the terminal even when the click landed
                  // on the tile chrome (header/padding) rather than the xterm
                  // textarea — and on a re-click of the already-focused tile,
                  // where the `focused` prop wouldn't change to re-trigger it.
                  focusTerminal(session.id);
                }}
                // Only the focused tile forwards keystrokes to its Terminal;
                // others stop input at the capture phase before it reaches xterm.
                onKeyDownCapture={(e) => {
                  if (!isFocused) {
                    e.stopPropagation();
                  }
                }}
              >
                <div className="workspace-tile-header">
                  <span className="workspace-tile-name" title={namesBySession[session.id]}>
                    {namesBySession[session.id]}
                  </span>
                  <SessionActions
                    sessionId={session.id}
                    isExpanded={false}
                    onExpand={onExpand}
                    onCollapse={() => {}}
                    onClose={onClose}
                  />
                </div>
                {isPaused && (
                  <div className="workspace-tile-paused" data-testid="tile-paused">
                    <span className="workspace-tile-paused-badge">Paused</span>
                    <button
                      type="button"
                      className="workspace-tile-resume"
                      aria-label={`Resume session ${session.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void setSessionPaused(session.id, false);
                      }}
                    >
                      Resume
                    </button>
                  </div>
                )}
                <Terminal sessionId={session.id} focused={isFocused} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
