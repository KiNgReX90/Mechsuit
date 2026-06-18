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
import { setSessionPaused } from "../../ipc/commands";
import { focusSession } from "../../lib/focusSession";
import { SessionActions } from "./SessionActions";

/** A status that warrants a visible color cue (the alert-worthy states). */
export type TileStatusKind = "ready" | "awaiting-approval" | "error";

/**
 * Map a session's status record to its visible status kind, or null for the
 * neutral default (no entry or `working`). A `ready` session alerts until
 * acknowledged — either by the engine's blink window elapsing or the user
 * focusing it — after which it clears back to neutral, so a finished session
 * never lingers green. FOCUS WINS: callers drop this entirely for the focused
 * session so it never also carries a status color. Shared by the grid tiles and
 * the expanded-mode tab strip, which dress the same kinds with their own prefix.
 */
export function tileStatusKind(
  record: SessionStatusState | undefined,
): TileStatusKind | null {
  if (!record) return null;
  switch (record.status) {
    case "ready":
      return record.acknowledged ? null : "ready";
    case "awaiting-approval":
      return "awaiting-approval";
    case "error":
      return "error";
    case "working":
    default:
      return null;
  }
}

/** The grid-tile class for a status record (`workspace-tile--<kind>`), or null. */
export function tileStatusClass(record: SessionStatusState | undefined): string | null {
  const kind = tileStatusKind(record);
  return kind ? `workspace-tile--${kind}` : null;
}

export interface GridProps {
  sessions: SessionInfo[];
  focusedSessionId: string | null;
  onExpand: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  /**
   * Whether each tile shows the expand control. Defaults to `true` (the normal
   * Workspace grid). The collected view passes `false` so its bays omit the
   * per-tile expand-to-fill action.
   */
  showExpand?: boolean;
}

export function Grid({
  sessions,
  focusedSessionId,
  onExpand,
  onClose,
  showExpand = true,
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
                // Switch focus to this tile: clears its screen when switching
                // in (Ctrl+L), selects it, and pulls DOM focus — the same
                // routine Shift+Arrow navigation uses (see focusSession).
                onClick={() => focusSession(session.id)}
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
                    showExpand={showExpand}
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
