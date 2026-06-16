/**
 * Per-session icon action group for a tile header.
 *
 * A compact horizontal row of icon buttons scoped to one session:
 *  - Clear   — sends `/clear` + Enter via `writeSession` directly.
 *  - Compact — sends `/compact` + Enter via `writeSession` directly.
 *  - Expand / Collapse — fires a parent callback (parent owns expand state).
 *  - Close   — fires `onClose` (parent kills the session + clears UI state).
 *
 * Presentational only: no store imports. Every button stops click propagation
 * so it never bubbles to the tile's focus handler.
 */
import { writeSession } from "../../ipc/commands";

export interface SessionActionsProps {
  /** Session these actions operate on. */
  sessionId: string;
  /** Whether this session is currently expanded to fill the workspace. */
  isExpanded: boolean;
  /** Expand this session to fill the workspace. */
  onExpand: (sessionId: string) => void;
  /** Collapse the expanded session back to the grid. */
  onCollapse: (sessionId: string) => void;
  /** Close (kill) this session. */
  onClose: (sessionId: string) => void;
}

function stop(e: React.MouseEvent) {
  e.stopPropagation();
}

export function SessionActions({
  sessionId,
  isExpanded,
  onExpand,
  onCollapse,
  onClose,
}: SessionActionsProps) {
  return (
    <div className="session-actions">
      <button
        type="button"
        className="session-action session-action--clear"
        aria-label={`Clear session ${sessionId}`}
        onClick={(e) => {
          stop(e);
          void writeSession(sessionId, "/clear\r");
        }}
      >
        {/* refresh */}
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
          <path d="M12.5 1.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button
        type="button"
        className="session-action session-action--compact"
        aria-label={`Compact session ${sessionId}`}
        onClick={(e) => {
          stop(e);
          void writeSession(sessionId, "/compact\r");
        }}
      >
        {/* box / package */}
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path
            d="M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5Z"
            strokeLinejoin="round"
          />
          <path d="M2 5l6 3.5L14 5M8 8.5V14.5" strokeLinejoin="round" />
        </svg>
      </button>

      {isExpanded ? (
        <button
          type="button"
          className="session-action session-action--collapse"
          aria-label="Collapse session"
          onClick={(e) => {
            stop(e);
            onCollapse(sessionId);
          }}
        >
          {/* collapse arrows (inward) */}
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              d="M6.5 9.5 2 14M6.5 9.5v3.5M6.5 9.5H3M9.5 6.5 14 2M9.5 6.5V3M9.5 6.5H13"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          className="session-action session-action--expand"
          aria-label={`Expand session ${sessionId}`}
          onClick={(e) => {
            stop(e);
            onExpand(sessionId);
          }}
        >
          {/* expand arrows (outward) */}
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              d="M9.5 6.5 14 2M14 2v3.5M14 2h-3.5M6.5 9.5 2 14M2 14v-3.5M2 14h3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      <button
        type="button"
        className="session-action session-action--close"
        aria-label={`Close session ${sessionId}`}
        onClick={(e) => {
          stop(e);
          onClose(sessionId);
        }}
      >
        {/* × */}
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
