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
import { SessionActions } from "./SessionActions";

/**
 * Map a session's status record to a tile status class. Returns null for the
 * neutral default (no entry or `working`). A `ready` session blinks green until
 * acknowledged, then settles to a steady (non-blinking) green so it still reads
 * as done at a glance without nagging. FOCUS WINS: callers must drop this class
 * entirely for the focused tile so it never also carries a status color.
 */
export function tileStatusClass(record: SessionStatusState | undefined): string | null {
  if (!record) return null;
  switch (record.status) {
    case "ready":
      return record.acknowledged
        ? "workspace-tile--ready-seen"
        : "workspace-tile--ready";
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
            // FOCUS WINS: a focused tile shows only the accent border, never a
            // status color; status still lives in the store for other readers.
            const statusClass = isFocused
              ? null
              : tileStatusClass(statusBySession[session.id]);
            const className = [
              "workspace-tile",
              isFocused ? "workspace-tile--focused" : null,
              statusClass,
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
                onClick={() => onFocus(session.id)}
                // Only the focused tile forwards keystrokes to its Terminal;
                // others stop input at the capture phase before it reaches xterm.
                onKeyDownCapture={(e) => {
                  if (!isFocused) {
                    e.stopPropagation();
                  }
                }}
              >
                <div className="workspace-tile-header">
                  <SessionActions
                    sessionId={session.id}
                    isExpanded={false}
                    onExpand={onExpand}
                    onCollapse={() => {}}
                    onClose={onClose}
                  />
                </div>
                <Terminal sessionId={session.id} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
