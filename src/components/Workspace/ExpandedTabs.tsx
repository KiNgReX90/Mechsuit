/**
 * Tab strip for the expanded workspace view.
 *
 * When one session fills the workspace, the grid's other tiles are hidden — so
 * this strip lists every session in the directory as a tab, keeping them one
 * click (or one Shift+Arrow) away. The active tab marks the expanded session;
 * the rest carry the same status color as their grid tile would (via
 * {@link tileStatusKind}), so finishing/awaiting sessions still announce
 * themselves while hidden. FOCUS WINS: the active tab shows the accent, never a
 * status color.
 */
import type { SessionInfo } from "../../types";
import { useSessionsStore } from "../../state/sessionsStore";
import { useStatusStore } from "../../state/statusStore";
import { usePausedStore } from "../../state/pausedStore";

import { tileStatusKind } from "./Grid";

export interface ExpandedTabsProps {
  /** All sessions in the expanded directory, in grid order. */
  sessions: SessionInfo[];
  /** The session currently filling the workspace. */
  activeSessionId: string;
  /** Switch the expanded (and focused) session to this id. */
  onSelect: (sessionId: string) => void;
}

export function ExpandedTabs({
  sessions,
  activeSessionId,
  onSelect,
}: ExpandedTabsProps) {
  const namesBySession = useSessionsStore((s) => s.namesBySession);
  const statusBySession = useStatusStore((s) => s.statusBySession);
  const pausedIds = usePausedStore((s) => s.pausedIds);

  return (
    <div className="expanded-tabs" data-testid="expanded-tabs" role="tablist">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        // FOCUS WINS: the active tab shows the accent, not a status color.
        const kind = isActive ? null : tileStatusKind(statusBySession[session.id]);
        const className = [
          "expanded-tab",
          isActive ? "expanded-tab--active" : null,
          kind ? `expanded-tab--${kind}` : null,
          pausedIds.has(session.id) ? "expanded-tab--paused" : null,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            type="button"
            key={session.id}
            className={className}
            role="tab"
            aria-selected={isActive}
            data-session-id={session.id}
            data-active={isActive ? "true" : "false"}
            title={namesBySession[session.id]}
            onClick={() => onSelect(session.id)}
          >
            {namesBySession[session.id]}
          </button>
        );
      })}
    </div>
  );
}
