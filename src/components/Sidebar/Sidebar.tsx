/**
 * Left sidebar: the list of managed directories.
 *
 * On mount it loads directories via the store (which calls `listDirectories`).
 * Each directory renders as a button whose identity line leads with the repo
 * name (the remote basename, falling back to the repo-root folder) and, for a
 * git repo, the current branch as a chip. Every repo card shows the on-disk
 * folder as a subtitle on the meta line — even a plain clone whose folder
 * matches the repo name — so the card always names its directory; a non-git
 * folder has only its single name. An "edited X
 * ago" label (with a stale style + dot once past the threshold) is derived from
 * `lastModified` and pinned to the right of the meta line. A `+` control adds a
 * directory by path; a per-
 * directory remove control removes it — confirming first (and killing live
 * sessions) when the directory has active sessions. Clicking a directory
 * selects it in `uiStore`.
 */
import { useCallback, useEffect, useState } from "react";

import { discoverDirectories } from "../../ipc/commands";
import { directoryIdentity } from "../../lib/directoryIdentity";
import { selectableCandidates } from "../../lib/discovery";
import { isStale, relativeTime } from "../../lib/relativeTime";
import {
  summarizeSessionStatuses,
  type StatusBadge,
} from "../../lib/sessionStatusSummary";
import { useDirectoriesStore } from "../../state/directoriesStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useStatusStore } from "../../state/statusStore";
import { useUiStore } from "../../state/uiStore";
import type { DiscoveredDir, SessionStatus } from "../../types";

import { useDirectoryDragReorder } from "./useDirectoryDragReorder";
import "./Sidebar.css";

/** Human-readable label per badged status, used for the badge's accessible name. */
const STATUS_LABEL: Record<SessionStatus, string> = {
  ready: "ready",
  "awaiting-approval": "awaiting approval",
  error: "error",
  working: "working",
};

function Sidebar() {
  const directories = useDirectoriesStore((s) => s.directories);
  const load = useDirectoriesStore((s) => s.load);
  const add = useDirectoriesStore((s) => s.add);
  const remove = useDirectoriesStore((s) => s.remove);
  const reorder = useDirectoriesStore((s) => s.reorder);

  const sessionsByDirectory = useSessionsStore((s) => s.sessionsByDirectory);
  const removeSession = useSessionsStore((s) => s.removeSession);

  const statusBySession = useStatusStore((s) => s.statusBySession);

  const selectedDirectoryPath = useUiStore((s) => s.selectedDirectoryPath);
  const setSelectedDirectoryPath = useUiStore(
    (s) => s.setSelectedDirectoryPath,
  );

  const [adding, setAdding] = useState(false);
  const [draftPath, setDraftPath] = useState("");
  /** Discovered candidate directories shown in the add combobox dropdown. */
  const [suggestions, setSuggestions] = useState<DiscoveredDir[]>([]);
  /** True while a discovery walk is in flight (drives the loading indicator). */
  const [discovering, setDiscovering] = useState(false);
  /** Path of the directory whose remove is awaiting confirmation, or null. */
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);

  // Drag-to-reorder the directory buttons; persists the new order on drop.
  const drag = useDirectoryDragReorder(
    directories.map((d) => d.path),
    reorder,
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Run a discovery walk and refresh the cached suggestions. The walk is slow
   * (a bounded filesystem scan that shells out to git per candidate), so it is
   * never awaited inline on the open path: results land in state when ready and
   * `discovering` drives a loading indicator until then. Errors keep whatever
   * suggestions we already have rather than blanking the dropdown.
   */
  const runDiscovery = useCallback(() => {
    setDiscovering(true);
    discoverDirectories()
      .then(setSuggestions)
      .catch(() => {})
      .finally(() => setDiscovering(false));
  }, []);

  // Prime discovery in the background on mount so the dropdown is already warm
  // by the time the user clicks "+" — opening is then instant in the common
  // case, with the loading indicator only ever seen on a cold first click.
  useEffect(() => {
    runDiscovery();
  }, [runDiscovery]);

  const closeAdd = () => {
    setAdding(false);
    setDraftPath("");
  };

  /**
   * Toggle the add combobox. Opening shows the already-warmed suggestions
   * instantly and kicks off a fresh discovery to revalidate them
   * (stale-while-revalidate); closing just hides the dropdown — the cached
   * suggestions are kept so the next open stays instant.
   */
  const toggleAdd = () => {
    if (adding) {
      closeAdd();
      return;
    }
    setAdding(true);
    runDiscovery();
  };

  const submitAdd = async () => {
    const path = draftPath.trim();
    if (!path) {
      return;
    }
    await add(path);
    closeAdd();
  };

  /** Add a discovered candidate from the dropdown. */
  const selectCandidate = async (candidate: DiscoveredDir) => {
    await add(candidate.path);
    closeAdd();
  };

  // The input doubles as a filter over the discovered candidates. Already-managed
  // directories are dropped (you can't add what's already there); the rest are
  // matched by name or path against the query (empty input shows them all).
  const filteredSuggestions = selectableCandidates(suggestions, draftPath);
  const showLoading = discovering && filteredSuggestions.length === 0;

  /** Active sessions for a directory (empty array when none tracked). */
  const sessionsFor = (path: string) => sessionsByDirectory[path] ?? [];

  /** Status count badges for a directory's tracked sessions. */
  const badgesFor = (path: string): StatusBadge[] =>
    summarizeSessionStatuses(
      sessionsFor(path).map((s) => statusBySession[s.id]?.status),
    );

  /**
   * Remove a directory. With active sessions, open the in-UI confirm; without,
   * remove directly.
   */
  const onRemoveClick = (path: string) => {
    if (sessionsFor(path).length > 0) {
      setConfirmingPath(path);
      return;
    }
    void remove(path);
  };

  /** Confirm path: kill every active session, then remove the directory. */
  const confirmRemove = async (path: string) => {
    const sessions = sessionsFor(path);
    for (const session of sessions) {
      await removeSession(path, session.id);
    }
    await remove(path);
    setConfirmingPath(null);
  };

  return (
    <div className="sidebar-content">
      <div className="sidebar-header">
        <span className="sidebar-title">Workspaces</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="sidebar-add-button"
            aria-label="Add workspace"
            aria-expanded={adding}
            onClick={toggleAdd}
          >
            +
          </button>
        </div>
      </div>

      {adding && (
        <div className="sidebar-add">
          <form
            className="sidebar-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAdd();
            }}
          >
            <input
              type="text"
              className="sidebar-add-input"
              aria-label="Workspace path"
              placeholder="Filter ~/dev or type a path…"
              value={draftPath}
              onChange={(e) => setDraftPath(e.target.value)}
              role="combobox"
              aria-expanded={filteredSuggestions.length > 0}
              autoFocus
            />
            <button type="submit" className="sidebar-add-submit">
              Add
            </button>
          </form>

          {showLoading && (
            <div className="sidebar-add-loading" role="status">
              <span className="sidebar-add-spinner" aria-hidden="true" />
              Scanning for workspaces…
            </div>
          )}

          {filteredSuggestions.length > 0 && (
            <ul
              className="sidebar-add-suggestions"
              role="listbox"
              aria-label="Discovered directories"
            >
              {filteredSuggestions.map((candidate) => (
                <li
                  key={candidate.path}
                  className="sidebar-add-suggestion-item"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="sidebar-add-suggestion"
                    onClick={() => void selectCandidate(candidate)}
                  >
                    <span className="sidebar-add-suggestion-head">
                      <span className="sidebar-add-suggestion-name">
                        {candidate.name}
                      </span>
                      {candidate.isGitRepo && candidate.branch && (
                        <span className="sidebar-add-suggestion-branch">
                          {candidate.branch}
                        </span>
                      )}
                    </span>
                    <span className="sidebar-add-suggestion-path">
                      {candidate.path}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="sidebar-list" ref={drag.listRef}>
        {directories.map((dir, index) => {
          const isActive = dir.path === selectedDirectoryPath;
          const edited = relativeTime(dir.lastModified);
          const stale = isStale(dir.lastModified);
          const sessionCount = sessionsFor(dir.path).length;
          const badges = badgesFor(dir.path);
          const identity = directoryIdentity(dir);
          const hasMeta = Boolean(identity.folder || edited);
          const isConfirming = confirmingPath === dir.path;
          const isDragging = drag.draggingPath === dir.path;
          return (
            <li
              key={dir.path}
              ref={(el) => drag.registerRow(dir.path, el)}
              className={
                isDragging
                  ? "sidebar-directory-item sidebar-directory-item--dragging"
                  : "sidebar-directory-item"
              }
            >
              <div className="sidebar-directory-row">
                <button
                  type="button"
                  className={
                    isActive
                      ? "sidebar-directory sidebar-directory--active"
                      : "sidebar-directory"
                  }
                  aria-current={isActive ? "true" : undefined}
                  onPointerDown={(e) => drag.onRowPointerDown(index, e)}
                  onClick={() => {
                    // Suppress the click that trails a drag so a reorder never
                    // also re-selects the row it just moved.
                    if (drag.consumeClickSuppression()) return;
                    setSelectedDirectoryPath(dir.path);
                  }}
                >
                  <span className="sidebar-directory-head">
                    {/* Leading identity glyph: a repository mark for git repos,
                        a folder mark otherwise — so every card is icon-led and
                        the glyph honestly reflects what the primary name is. */}
                    {dir.isGitRepo ? (
                      <svg
                        className="sidebar-directory-icon"
                        data-testid="repo-icon"
                        viewBox="0 0 16 16"
                        width="12"
                        height="12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {/* A book/repository: cover with a spine, an inner page
                            edge near the bottom, and a title line. */}
                        <path d="M4 2.7h8c.4 0 .7.3.7.7v9.2c0 .4-.3.7-.7.7H5.3A1.8 1.8 0 0 1 3.5 11.5V4.2A1.5 1.5 0 0 1 5 2.7Z" />
                        <path d="M3.5 11.5A1.8 1.8 0 0 1 5.3 9.8h7.4" />
                        <path d="M5.9 5.5h3.6" />
                      </svg>
                    ) : (
                      <svg
                        className="sidebar-directory-icon"
                        viewBox="0 0 16 16"
                        width="12"
                        height="12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M1.8 4.3c0-.6.5-1.1 1.1-1.1h3L7.3 4.8h5.8c.6 0 1.1.5 1.1 1.1v6c0 .6-.5 1.1-1.1 1.1H2.9c-.6 0-1.1-.5-1.1-1.1V4.3z" />
                      </svg>
                    )}
                    <span className="sidebar-directory-name">
                      {identity.primary}
                    </span>
                    {dir.isGitRepo && dir.branch && (
                      <span className="sidebar-directory-branch">
                        {/* Fixed-size branch glyph (never squished by a long
                            branch name). */}
                        <svg
                          viewBox="0 0 16 16"
                          width="11"
                          height="11"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="4.5" cy="3.5" r="1.7" />
                          <circle cx="4.5" cy="12.5" r="1.7" />
                          <circle cx="11.5" cy="3.5" r="1.7" />
                          <path d="M4.5 5.2v5.6" />
                          <path d="M11.5 5.2v1c0 2.1-1.7 3.8-3.8 3.8H6" />
                        </svg>
                        {/* Long branch names truncate at the FRONT (…tail), so
                            the meaningful end (feature slug) stays visible. */}
                        <span className="sidebar-directory-branch-name">
                          {dir.branch}
                        </span>
                      </span>
                    )}
                    {badges.length > 0 && (
                      <span className="sidebar-directory-status">
                        {badges.map((b) => {
                          const label = `${b.count} ${STATUS_LABEL[b.status]}`;
                          return (
                            <span
                              key={b.status}
                              className={`sidebar-status-badge sidebar-status-badge--${b.status}`}
                              aria-label={label}
                              title={label}
                            >
                              {b.count}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>

                  {hasMeta && (
                    <span className="sidebar-directory-meta">
                      {identity.folder && (
                        <span className="sidebar-directory-folder">
                          {/* Folder glyph: marks this as the on-disk directory,
                              distinct from the repo identity above. */}
                          <svg
                            viewBox="0 0 16 16"
                            width="11"
                            height="11"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M1.8 4.3c0-.6.5-1.1 1.1-1.1h3L7.3 4.8h5.8c.6 0 1.1.5 1.1 1.1v6c0 .6-.5 1.1-1.1 1.1H2.9c-.6 0-1.1-.5-1.1-1.1V4.3z" />
                          </svg>
                          <span className="sidebar-directory-folder-name">
                            {identity.folder}
                          </span>
                        </span>
                      )}
                      {edited && (
                        <span
                          className={
                            stale
                              ? "sidebar-directory-edited sidebar-directory-edited--stale"
                              : "sidebar-directory-edited"
                          }
                        >
                          {stale && (
                            <span
                              className="sidebar-directory-stale-dot"
                              aria-hidden="true"
                            />
                          )}
                          edited {edited}
                        </span>
                      )}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className="sidebar-directory-remove"
                  aria-label={`Remove ${dir.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveClick(dir.path);
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
                    <path
                      d="M3.5 3.5l9 9M12.5 3.5l-9 9"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              {isConfirming && (
                <div className="sidebar-directory-confirm" role="alertdialog">
                  <span className="sidebar-directory-confirm-message">
                    {dir.name} has {sessionCount} live{" "}
                    {sessionCount === 1 ? "session" : "sessions"} — remove and
                    kill {sessionCount === 1 ? "it" : "them"}?
                  </span>
                  <div className="sidebar-directory-confirm-actions">
                    <button
                      type="button"
                      className="sidebar-directory-confirm-yes"
                      onClick={() => void confirmRemove(dir.path)}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="sidebar-directory-confirm-no"
                      onClick={() => setConfirmingPath(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}

        {/* Glowing insertion line marking where the dragged button will land. */}
        {drag.dropLineTop !== null && (
          <div
            className="sidebar-drop-line"
            data-testid="sidebar-drop-line"
            style={{ top: drag.dropLineTop }}
            aria-hidden="true"
          />
        )}

        {/* Floating clone of the dragged button, following the cursor. */}
        {drag.draggingPath !== null &&
          drag.cloneTop !== null &&
          (() => {
            const dragging = directories.find(
              (d) => d.path === drag.draggingPath,
            );
            if (!dragging) return null;
            const cloneIdentity = directoryIdentity(dragging);
            return (
              <div
                className="sidebar-drag-clone"
                style={{ top: drag.cloneTop }}
                aria-hidden="true"
              >
                <span className="sidebar-directory-name">
                  {cloneIdentity.primary}
                </span>
                {dragging.isGitRepo && dragging.branch && (
                  <span className="sidebar-directory-branch">
                    {dragging.branch}
                  </span>
                )}
              </div>
            );
          })()}
      </ul>
    </div>
  );
}

export default Sidebar;
