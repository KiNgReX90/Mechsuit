/**
 * Per-session icon action group for a tile header.
 *
 * A compact horizontal row of icon buttons scoped to one session:
 *  - Clear   — sends `/clear` + Enter via `writeSession` directly.
 *  - Compact — sends `/compact` + Enter via `writeSession` directly.
 *  - Expand / Collapse — fires a parent callback (parent owns expand state).
 *  - Close   — fires `onClose` (parent kills the session + clears UI state).
 *
 * Clear and Compact follow their command with a Ctrl+L redraw once the command
 * write resolves (see `sendThenRedraw`), so the running program repaints a clean
 * screen after the command lands.
 *
 * Presentational only: no store imports. Every button stops click propagation
 * so it never bubbles to the tile's focus handler.
 */
import { writeSession } from "../../ipc/commands";

// Ctrl+L (form feed, 0x0C). Sent after a /clear or /compact so the running
// program (shell / Claude Code) repaints its screen. It carries no carriage
// return, so it reads as incidental input rather than a submitted line.
const REDRAW = "\f";

/**
 * Write a command to a session, then send a Ctrl+L redraw once that first write
 * resolves. Chaining (rather than firing both at once) guarantees the command
 * bytes reach the PTY before the redraw, so the screen repaints cleanly after.
 */
function sendThenRedraw(sessionId: string, command: string) {
  void writeSession(sessionId, command).then(() =>
    writeSession(sessionId, REDRAW),
  );
}

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
  /**
   * Whether to render the expand/collapse control. Defaults to `true` (the
   * normal Workspace grid). The collected view passes `false` so its tiles omit
   * expand — there is no per-bay expand-to-fill in that layout.
   */
  showExpand?: boolean;
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
  showExpand = true,
}: SessionActionsProps) {
  return (
    <div className="session-actions">
      <button
        type="button"
        className="session-action session-action--clear"
        aria-label={`Clear session ${sessionId}`}
        title="Clear (/clear)"
        onClick={(e) => {
          stop(e);
          sendThenRedraw(sessionId, "/clear\r");
        }}
      >
        {/* trash */}
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M2.5 4h11" strokeLinecap="round" />
          <path
            d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"
            strokeLinejoin="round"
          />
          <path
            d="M4 4l.6 9a1.2 1.2 0 0 0 1.2 1.1h4.4a1.2 1.2 0 0 0 1.2-1.1L13 4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M6.7 6.5v5M9.3 6.5v5" strokeLinecap="round" />
        </svg>
      </button>

      <button
        type="button"
        className="session-action session-action--compact"
        aria-label={`Compact session ${sessionId}`}
        title="Compact (/compact)"
        onClick={(e) => {
          stop(e);
          sendThenRedraw(sessionId, "/compact\r");
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

      {showExpand &&
        (isExpanded ? (
        <button
          type="button"
          className="session-action session-action--collapse"
          aria-label="Collapse session"
          title="Collapse"
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
          title="Expand"
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
        ))}

      <button
        type="button"
        className="session-action session-action--close"
        aria-label={`Close session ${sessionId}`}
        title="Close"
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
