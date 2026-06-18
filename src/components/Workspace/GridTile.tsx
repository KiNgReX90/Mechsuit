/**
 * Scoped per-tile component for the session grid.
 *
 * Subscribes only to its own session's status via a scoped selector so a
 * status transition (working↔idle↔ready) re-renders this tile alone — not the
 * whole grid. All visible behavior is preserved exactly: focused-tile accent
 * border, status-color border for non-focused tiles, paused dimming + Resume
 * button, header/name, SessionActions, click-to-focus, and the non-focused
 * capture-phase key swallowing.
 */
import { Terminal } from "../Terminal";
import type { SessionInfo } from "../../types";
import type { SessionStatusState } from "../../types";
import { useStatusStore } from "../../state/statusStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { usePausedStore } from "../../state/pausedStore";
import { setSessionPaused } from "../../ipc/commands";
import { focusSession } from "../../lib/focusSession";
import { SessionActions } from "./SessionActions";

// Inline the status-kind → CSS-class mapping to avoid a circular import
// (Grid → GridTile → Grid). Grid.tsx still owns and exports tileStatusKind /
// tileStatusClass for external consumers (e.g. Workspace.tsx); this copy is
// intentionally local and private.
function statusClass(record: SessionStatusState | undefined): string | null {
  if (!record) return null;
  switch (record.status) {
    case "ready":
      return record.acknowledged ? null : "workspace-tile--ready";
    case "awaiting-approval":
      return "workspace-tile--awaiting-approval";
    case "error":
      return "workspace-tile--error";
    default:
      return null;
  }
}

export interface GridTileProps {
  session: SessionInfo;
  isFocused: boolean;
  onExpand: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}

export function GridTile({ session, isFocused, onExpand, onClose }: GridTileProps) {
  // Scoped selector: reads ONLY this session's status. Zustand compares by
  // reference; the no-op guard in setStatus keeps the reference stable when
  // nothing changed, so unaffected tiles skip the render entirely.
  const statusRecord = useStatusStore((s) => s.statusBySession[session.id]);
  const name = useSessionsStore((s) => s.namesBySession[session.id]);
  const isPaused = usePausedStore((s) => s.pausedIds.has(session.id));

  // FOCUS WINS: a focused tile shows only the accent border, never a status color.
  const tileClass = isFocused ? null : statusClass(statusRecord);
  const className = [
    "workspace-tile",
    isFocused ? "workspace-tile--focused" : null,
    tileClass,
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
      // Claim focus as EARLY in the input sequence as possible — on
      // pointer-down, before the subsequent click and before any in-flight
      // keystroke from another pane can be processed. This pulls DOM focus onto
      // this terminal up front, shrinking the race window in which a stray
      // character could land in the wrong session. Uses the same routine
      // Shift+Arrow navigation does (clears via Ctrl+L on switch, selects, and
      // grabs DOM focus — see focusSession).
      onPointerDown={() => focusSession(session.id)}
      // Click is a harmless fallback for input paths that don't emit
      // pointerdown (e.g. synthetic clicks in tests, keyboard activation): it
      // only acts when this tile isn't already focused, so a real
      // pointerdown→click never double-fires focus (and never sends a second
      // Ctrl+L). focusSession is itself idempotent for the focused session.
      onClick={() => {
        if (!isFocused) focusSession(session.id);
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
        <span className="workspace-tile-name" title={name}>
          {name}
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
}
