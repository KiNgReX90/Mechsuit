/**
 * Left sidebar: the list of managed directories.
 *
 * On mount it loads directories via the store (which calls `listDirectories`).
 * Each directory renders as a button showing its name and path; git repos also
 * show the current branch beneath the path in a distinct color. Beneath that an
 * "edited X ago" label (with a stale style + dot once past the threshold) is
 * derived from `lastModified`. A `+` control adds a directory by path; a per-
 * directory remove control removes it — confirming first (and killing live
 * sessions) when the directory has active sessions. Clicking a directory
 * selects it in `uiStore`.
 */
import { useCallback, useEffect, useState } from "react";

import { discoverDirectories } from "../../ipc/commands";
import { selectableCandidates } from "../../lib/discovery";
import { isStale, relativeTime } from "../../lib/relativeTime";
import { useDirectoriesStore } from "../../state/directoriesStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useUiStore } from "../../state/uiStore";
import type { DiscoveredDir } from "../../types";

import "./Sidebar.css";

function Sidebar() {
  const directories = useDirectoriesStore((s) => s.directories);
  const load = useDirectoriesStore((s) => s.load);
  const add = useDirectoriesStore((s) => s.add);
  const remove = useDirectoriesStore((s) => s.remove);

  const sessionsByDirectory = useSessionsStore((s) => s.sessionsByDirectory);
  const removeSession = useSessionsStore((s) => s.removeSession);

  const selectedDirectoryPath = useUiStore((s) => s.selectedDirectoryPath);
  const setSelectedDirectoryPath = useUiStore(
    (s) => s.setSelectedDirectoryPath,
  );
  // The Settings drawer's open-state lives in uiStore so App can mount the
  // drawer in `.app-body` (the full-width positioned container, like Commander).
  // Mounting it here inside the 260px `.sidebar` made its `right: 0` anchor to
  // the sidebar's edge, so the drawer spilled off the left of the window.
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const [adding, setAdding] = useState(false);
  const [draftPath, setDraftPath] = useState("");
  /** Discovered candidate directories shown in the add combobox dropdown. */
  const [suggestions, setSuggestions] = useState<DiscoveredDir[]>([]);
  /** True while a discovery walk is in flight (drives the loading indicator). */
  const [discovering, setDiscovering] = useState(false);
  /** Path of the directory whose remove is awaiting confirmation, or null. */
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);

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
            className="sidebar-settings-button"
            aria-label="Settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
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

      <ul className="sidebar-list">
        {directories.map((dir) => {
          const isActive = dir.path === selectedDirectoryPath;
          const edited = relativeTime(dir.lastModified);
          const stale = isStale(dir.lastModified);
          const sessionCount = sessionsFor(dir.path).length;
          const isConfirming = confirmingPath === dir.path;
          return (
            <li key={dir.path} className="sidebar-directory-item">
              <div className="sidebar-directory-row">
                <button
                  type="button"
                  className={
                    isActive
                      ? "sidebar-directory sidebar-directory--active"
                      : "sidebar-directory"
                  }
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => setSelectedDirectoryPath(dir.path)}
                >
                  <span className="sidebar-directory-name">{dir.name}</span>
                  <span className="sidebar-directory-path">{dir.path}</span>
                  {dir.isGitRepo && dir.branch && (
                    <span className="sidebar-directory-branch">
                      {dir.branch}
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
      </ul>
    </div>
  );
}

export default Sidebar;
