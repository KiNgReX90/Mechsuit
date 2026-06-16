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
import { useEffect, useState } from "react";

import { discoverDirectories } from "../../ipc/commands";
import { isStale, relativeTime } from "../../lib/relativeTime";
import { useDirectoriesStore } from "../../state/directoriesStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useUiStore } from "../../state/uiStore";
import type { DiscoveredDir } from "../../types";
import { Settings } from "../Settings";

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

  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftPath, setDraftPath] = useState("");
  /** Discovered candidate directories shown in the add combobox dropdown. */
  const [suggestions, setSuggestions] = useState<DiscoveredDir[]>([]);
  /** Path of the directory whose remove is awaiting confirmation, or null. */
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const closeAdd = () => {
    setAdding(false);
    setSuggestions([]);
    setDraftPath("");
  };

  /**
   * Toggle the add combobox. Opening kicks off a discovery walk (under the
   * user's `~/dev`) to populate the dropdown; closing clears it.
   */
  const toggleAdd = () => {
    if (adding) {
      closeAdd();
      return;
    }
    setAdding(true);
    void discoverDirectories()
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  };

  const submitAdd = async () => {
    const path = draftPath.trim();
    if (!path) {
      return;
    }
    await add(path);
    closeAdd();
  };

  /** Add a discovered candidate from the dropdown (no-op if already managed). */
  const selectCandidate = async (candidate: DiscoveredDir) => {
    if (candidate.alreadyManaged) {
      return;
    }
    await add(candidate.path);
    closeAdd();
  };

  // The input doubles as a filter over the discovered candidates (by name or
  // path); an empty input shows them all.
  const query = draftPath.trim().toLowerCase();
  const filteredSuggestions = query
    ? suggestions.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.path.toLowerCase().includes(query),
      )
    : suggestions;

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
        <span className="sidebar-title">Directories</span>
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
            aria-label="Add directory"
            aria-expanded={adding}
            onClick={toggleAdd}
          >
            +
          </button>
        </div>
      </div>

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

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
              aria-label="Directory path"
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
                    disabled={candidate.alreadyManaged}
                    onClick={() => void selectCandidate(candidate)}
                  >
                    <span className="sidebar-add-suggestion-head">
                      <span className="sidebar-add-suggestion-name">
                        {candidate.name}
                      </span>
                      {candidate.alreadyManaged ? (
                        <span className="sidebar-add-suggestion-managed">
                          added
                        </span>
                      ) : (
                        candidate.isGitRepo &&
                        candidate.branch && (
                          <span className="sidebar-add-suggestion-branch">
                            {candidate.branch}
                          </span>
                        )
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
