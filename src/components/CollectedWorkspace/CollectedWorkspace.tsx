import { useEffect } from "react";

import { computeGridLayout } from "../../lib/gridLayout";
import { useActiveWorkspaces } from "../../lib/activeWorkspaces";
import { useSessionsStore } from "../../state/sessionsStore";
import { useUiStore } from "../../state/uiStore";
import { WorkspaceBay } from "./WorkspaceBay";
import "./CollectedWorkspace.css";

export interface CollectedWorkspaceProps {
  /** Whether the collected view is shown over the workspace body. */
  open: boolean;
  /** Dismiss the view. */
  onClose: () => void;
}

/**
 * Collected view: a full-body container that overlays the sidebar + workspace
 * when {@link CollectedWorkspaceProps.open} is true and renders nothing when
 * closed.
 *
 * It owns the open/close shell (header + close button, closable via that button
 * or Escape) and fills the body slot with one {@link WorkspaceBay} per active
 * workspace, laid out as a top-row-heavy auto-grid via {@link computeGridLayout}
 * (bays tile exactly as the session grid tiles terminals). The active set comes
 * live from {@link useActiveWorkspaces}, so bays appear and disappear as
 * sessions spawn and exit.
 *
 * Each bay is wired to the shared `sessionsStore`: its quick-spawn / add
 * controls spawn into that bay's own directory, and per-tile close kills +
 * removes from that directory. Focus is a single global `focusedSessionId`
 * (uiStore) shared across every bay.
 *
 * Performance: many xterms mount at once. We rely on the existing terminalPool
 * (terminals are re-parented, not re-created) and deliberately do NOT dispose
 * any terminal on overlay toggle, so flipping in and out of the collected view
 * never tears down or re-spawns a live session.
 */
export function CollectedWorkspace({ open, onClose }: CollectedWorkspaceProps) {
  const focusedSessionId = useUiStore((s) => s.focusedSessionId);
  const setFocusedSessionId = useUiStore((s) => s.setFocusedSessionId);
  const setExpandedSessionId = useUiStore((s) => s.setExpandedSessionId);
  const addSession = useSessionsStore((s) => s.addSession);
  const removeSession = useSessionsStore((s) => s.removeSession);

  const activeWorkspaces = useActiveWorkspaces();

  // Escape closes the view while it is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  // Spawn `count` terminals back-to-back into a specific bay's directory,
  // mirroring Workspace.handleSpawnTerminals but scoped per directory: spawns
  // run sequentially so the backend creates PTYs one at a time, and focus lands
  // on the last one added.
  const handleSpawnTerminals = (dirPath: string, count: number) => {
    if (count <= 0) return;
    void (async () => {
      let last: string | null = null;
      for (let i = 0; i < count; i += 1) {
        const info = await addSession(dirPath);
        last = info.id;
      }
      if (last) setFocusedSessionId(last);
    })();
  };

  // Close: kill + drop the session from its own directory, then clear any
  // global selection state pointing at it so the focus/expand guards do not
  // linger on a stale id.
  const handleCloseSession = (dirPath: string, id: string) => {
    void removeSession(dirPath, id);
    if (id === focusedSessionId) {
      setFocusedSessionId(null);
    }
    if (id === useUiStore.getState().expandedSessionId) {
      setExpandedSessionId(null);
    }
  };

  // Lay the bays out exactly as Grid lays out tiles: compute the row counts,
  // then slice the active workspaces into each row in order.
  const { rows } = computeGridLayout(activeWorkspaces.length);
  let cursor = 0;
  const rowSlices = rows.map((count) => {
    const slice = activeWorkspaces.slice(cursor, cursor + count);
    cursor += count;
    return slice;
  });

  return (
    <section
      className="collected-workspace"
      role="dialog"
      aria-label="Collected view"
    >
      <div className="collected-workspace-header">
        <span className="collected-workspace-title">Collected view</span>
        <button
          type="button"
          className="collected-workspace-close"
          aria-label="Close Collected view"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="collected-workspace-body">
        {activeWorkspaces.length === 0 ? (
          <p className="collected-workspace-empty">
            No workspace has a live session.
          </p>
        ) : (
          <div className="collected-workspace-grid" data-testid="collected-grid">
            {rowSlices.map((rowWorkspaces, rowIndex) => (
              <div
                className="collected-workspace-grid-row"
                data-testid="collected-grid-row"
                key={rowIndex}
              >
                {rowWorkspaces.map(({ directory, sessions }) => (
                  <WorkspaceBay
                    key={directory.path}
                    directory={directory}
                    sessions={sessions}
                    focusedSessionId={focusedSessionId}
                    onSpawnTerminals={(count) =>
                      handleSpawnTerminals(directory.path, count)
                    }
                    onCloseSession={(id) =>
                      handleCloseSession(directory.path, id)
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default CollectedWorkspace;
