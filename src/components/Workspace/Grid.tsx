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
import type { SessionInfo, SessionStatusState } from "../../types";
import { computeGridLayout } from "../../lib/gridLayout";
import { GridTile } from "./GridTile";

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
          {rowSessions.map((session) => (
            <GridTile
              key={session.id}
              session={session}
              isFocused={session.id === focusedSessionId}
              onExpand={onExpand}
              onClose={onClose}
              showExpand={showExpand}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
