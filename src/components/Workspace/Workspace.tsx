/**
 * Directory workspace view.
 *
 * Ties the frontend together for the selected directory:
 *  - an action bar whose first action spawns a session via the sessions store;
 *  - the selected directory's sessions tiled through `computeGridLayout`, each
 *    composing a `<Terminal>`;
 *  - expand/focus behavior driven by `uiStore` (`focusedSessionId`,
 *    `expandedSessionId`); clicking a tile focuses it, the expand control fills
 *    the workspace with a single Terminal and a control collapses back.
 *
 * Sessions are tracked per-directory in `sessionsStore`, so switching
 * `selectedDirectoryPath` swaps the visible grid while leaving other
 * directories' sessions intact. The store is loaded from `listSessions`
 * whenever the selected directory changes.
 */
import { useEffect } from "react";

import { Terminal } from "../Terminal";
import type { SessionInfo } from "../../types";
import { useSessionsStore } from "../../state/sessionsStore";
import { useUiStore } from "../../state/uiStore";
import { useStatusStore } from "../../state/statusStore";
import { usePausedStore } from "../../state/pausedStore";
import { setSessionPaused } from "../../ipc/commands";

import { ActionBar } from "./ActionBar";
import { Grid, tileStatusClass } from "./Grid";
import { SessionActions } from "./SessionActions";
import "./Workspace.css";

// Stable empty reference so the selector never returns a fresh array (which
// would make zustand's snapshot comparison loop forever).
const NO_SESSIONS: SessionInfo[] = [];

function Workspace() {
  const selectedDirectoryPath = useUiStore((s) => s.selectedDirectoryPath);
  const focusedSessionId = useUiStore((s) => s.focusedSessionId);
  const expandedSessionId = useUiStore((s) => s.expandedSessionId);
  const setFocusedSessionId = useUiStore((s) => s.setFocusedSessionId);
  const setExpandedSessionId = useUiStore((s) => s.setExpandedSessionId);

  const sessions = useSessionsStore((s) =>
    selectedDirectoryPath
      ? (s.sessionsByDirectory[selectedDirectoryPath] ?? NO_SESSIONS)
      : NO_SESSIONS,
  );
  const loadDirectory = useSessionsStore((s) => s.loadDirectory);
  const addSession = useSessionsStore((s) => s.addSession);
  const removeSession = useSessionsStore((s) => s.removeSession);

  const statusBySession = useStatusStore((s) => s.statusBySession);
  const pausedIds = usePausedStore((s) => s.pausedIds);

  // Populate the store for whichever directory is selected. Sessions spawned
  // for other directories remain in the store untouched. If, once loaded, the
  // directory has no live sessions (a fresh directory, or one whose sessions
  // Commander closed), auto-spawn one — every workspace should land on a live
  // agent session rather than an empty grid.
  useEffect(() => {
    if (!selectedDirectoryPath) return;
    let cancelled = false;
    void (async () => {
      await loadDirectory(selectedDirectoryPath);
      if (cancelled) return;
      const current =
        useSessionsStore.getState().sessionsByDirectory[selectedDirectoryPath] ??
        [];
      if (current.length === 0) {
        const info = await addSession(selectedDirectoryPath);
        if (!cancelled && info) setFocusedSessionId(info.id);
      }
    })().catch(() => {
      // Best-effort: loading or auto-spawning a session must never crash the
      // workspace (e.g. a backend spawn failure). A failed session surfaces via
      // its own error status instead.
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDirectoryPath, loadDirectory, addSession, setFocusedSessionId]);

  if (!selectedDirectoryPath) {
    return (
      <div className="workspace-content workspace-content--empty">
        <ActionBar
          hasDirectory={false}
          sessionCount={0}
          onSpawnTerminals={() => {}}
        />
        <p className="workspace-empty-hint">Select a workspace to begin.</p>
      </div>
    );
  }

  // Spawn `count` terminals back-to-back (the single add button passes 1; a
  // quick-spawn option passes however many reach its target). Spawns run
  // sequentially so the backend creates PTYs one at a time; focus lands on the
  // last one added.
  const handleSpawnTerminals = (count: number) => {
    if (count <= 0) return;
    void (async () => {
      let last: string | null = null;
      for (let i = 0; i < count; i += 1) {
        const info = await addSession(selectedDirectoryPath);
        last = info.id;
      }
      if (last) setFocusedSessionId(last);
    })();
  };

  // Close: kill + drop the session, then clear any selection state that
  // pointed at it so the expanded/focus guards do not linger on a stale id.
  const handleCloseSession = (id: string) => {
    void removeSession(selectedDirectoryPath, id);
    if (id === focusedSessionId) {
      setFocusedSessionId(null);
    }
    if (id === expandedSessionId) {
      setExpandedSessionId(null);
    }
  };

  // When a session is expanded, it fills the workspace; the grid is hidden.
  const expanded =
    expandedSessionId &&
    sessions.some((s) => s.id === expandedSessionId)
      ? expandedSessionId
      : null;

  return (
    <div className="workspace-content">
      <ActionBar
        hasDirectory
        sessionCount={sessions.length}
        onSpawnTerminals={handleSpawnTerminals}
      />

      {expanded ? (
        (() => {
          const expandedPaused = pausedIds.has(expanded);
          return (
            <div
              className={[
                "workspace-expanded",
                // FOCUS WINS: the expanded tile shows the accent border when it is
                // the focused session, otherwise its status color.
                expanded === focusedSessionId
                  ? "workspace-tile--focused"
                  : tileStatusClass(statusBySession[expanded]),
                expandedPaused ? "workspace-tile--paused" : null,
              ]
                .filter(Boolean)
                .join(" ")}
              data-testid="workspace-expanded"
            >
              <div className="workspace-tile-header">
                <SessionActions
                  sessionId={expanded}
                  isExpanded
                  onExpand={setExpandedSessionId}
                  onCollapse={() => setExpandedSessionId(null)}
                  onClose={handleCloseSession}
                />
              </div>
              {expandedPaused && (
                <div className="workspace-tile-paused" data-testid="tile-paused">
                  <span className="workspace-tile-paused-badge">Paused</span>
                  <button
                    type="button"
                    className="workspace-tile-resume"
                    aria-label={`Resume session ${expanded}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void setSessionPaused(expanded, false);
                    }}
                  >
                    Resume
                  </button>
                </div>
              )}
              <Terminal sessionId={expanded} />
            </div>
          );
        })()
      ) : (
        <Grid
          sessions={sessions}
          focusedSessionId={focusedSessionId}
          onFocus={setFocusedSessionId}
          onExpand={setExpandedSessionId}
          onClose={handleCloseSession}
        />
      )}
    </div>
  );
}

export default Workspace;
