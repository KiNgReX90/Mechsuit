/**
 * Inline action group for a TERMINAL graph node: pause/resume + kill.
 *
 * Presentational and self-contained except for the kill confirmation, which it
 * owns as a two-step inline toggle (first click arms it, second confirms) so a
 * stray click never tears down a live session — the graph has no modal layer to
 * borrow. Mirrors the Workspace/SessionActions icon-button + stop-propagation
 * convention: every button calls `stopPropagation` so a click never bubbles to
 * the node's navigate handler or the canvas pan handler.
 *
 * Aggregate (repo/worktree) and subagent nodes get NO actions — GraphNode only
 * renders this for terminal nodes.
 */
import { useState } from "react";

export interface NodeActionsProps {
  /** Terminal session these actions operate on. */
  sessionId: string;
  /** Whether the session is currently paused (from pausedStore). */
  isPaused: boolean;
  /** Toggle pause/resume for the session. */
  onTogglePause: (sessionId: string, paused: boolean) => void;
  /** Kill the session (only fired after inline confirmation). */
  onKill: (sessionId: string) => void;
}

function stop(e: React.MouseEvent) {
  e.stopPropagation();
}

export function NodeActions({
  sessionId,
  isPaused,
  onTogglePause,
  onKill,
}: NodeActionsProps) {
  const [confirmingKill, setConfirmingKill] = useState(false);

  return (
    <span className="graph-node-actions" data-testid="node-actions">
      <button
        type="button"
        className={`node-action node-action--pause${isPaused ? " node-action--resume" : ""}`}
        aria-label={
          isPaused ? `Resume session ${sessionId}` : `Pause session ${sessionId}`
        }
        onClick={(e) => {
          stop(e);
          onTogglePause(sessionId, !isPaused);
        }}
      >
        {isPaused ? (
          /* play (resume) */
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
            <path d="M5 3.5v9l7-4.5-7-4.5Z" />
          </svg>
        ) : (
          /* pause (two bars) */
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
            <path d="M5 3h2.2v10H5zM8.8 3H11v10H8.8z" />
          </svg>
        )}
      </button>

      {confirmingKill ? (
        <>
          <button
            type="button"
            className="node-action node-action--kill-confirm"
            aria-label={`Confirm kill session ${sessionId}`}
            onClick={(e) => {
              stop(e);
              setConfirmingKill(false);
              onKill(sessionId);
            }}
          >
            Kill?
          </button>
          <button
            type="button"
            className="node-action node-action--kill-cancel"
            aria-label={`Cancel kill session ${sessionId}`}
            onClick={(e) => {
              stop(e);
              setConfirmingKill(false);
            }}
          >
            {/* × */}
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />
            </svg>
          </button>
        </>
      ) : (
        <button
          type="button"
          className="node-action node-action--kill"
          aria-label={`Kill session ${sessionId}`}
          onClick={(e) => {
            stop(e);
            setConfirmingKill(true);
          }}
        >
          {/* trash */}
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </span>
  );
}

export default NodeActions;
