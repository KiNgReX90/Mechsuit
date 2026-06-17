import "./App.css";

import { useEffect, useMemo } from "react";

import { Commander } from "./components/Commander";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { UsageBar } from "./components/UsageBar";
import { Workspace } from "./components/Workspace";
import { commanderSend } from "./ipc/commands";
import { onCommanderDirectoriesChanged, onCommanderNavigate } from "./ipc/events";
import type { CommanderEngine } from "./lib/commander/types";
import { mostRecentlyModified } from "./lib/recentWorkspace";
import { useDirectoriesStore } from "./state/directoriesStore";
import { StatusEngine } from "./state/statusEngine";
import { useUiStore } from "./state/uiStore";

/**
 * Root application shell: a column of title bar, body, and usage footer.
 *  - `<TitleBar/>` — custom window chrome for the borderless window (drag
 *    region + minimize/maximize/close), pinned at the top of the shell.
 *  - `<aside>` left sidebar region — mounts the stub <Sidebar/>.
 *  - `<main>` workspace region — mounts the stub <Workspace/>.
 *  - `<StatusEngine/>` — null-rendering, app-wide status derivation; mounted
 *    once here so it runs regardless of which workspace is shown.
 *  - `<Commander/>` — chat overlay over the workspace, toggled by Ctrl+Shift+C
 *    and driven by `commanderOpen`. Its engine wraps the `commanderSend` IPC
 *    command. A `commander://navigate` event selects the resolved directory.
 *  - `<UsageBar/>` — slim full-width footer pinned below the sidebar+workspace
 *    row; the single owner of the `usage://updated` subscription.
 * Feature items fill the stub components in later rounds.
 */
function App() {
  const commanderOpen = useUiStore((state) => state.commanderOpen);
  const setCommanderOpen = useUiStore((state) => state.setCommanderOpen);
  const toggleCommander = useUiStore((state) => state.toggleCommander);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const setSelectedDirectoryPath = useUiStore(
    (state) => state.setSelectedDirectoryPath,
  );
  const selectedDirectoryPath = useUiStore(
    (state) => state.selectedDirectoryPath,
  );
  const directories = useDirectoriesStore((state) => state.directories);
  const loadDirectories = useDirectoriesStore((state) => state.load);

  // The real Commander engine: thin wrapper over the `commanderSend` IPC
  // command, satisfying the `CommanderEngine` interface the overlay codes to.
  const engine = useMemo<CommanderEngine>(
    () => ({ ask: (message, sessionId) => commanderSend(message, sessionId) }),
    [],
  );

  // On startup (and any time nothing is selected) land on the most recently
  // modified workspace, so the app opens on live panes instead of an empty
  // grid. Guarded on a null selection so it never fights an explicit choice.
  useEffect(() => {
    if (selectedDirectoryPath != null) return;
    const target = mostRecentlyModified(directories);
    if (target) setSelectedDirectoryPath(target.path);
  }, [directories, selectedDirectoryPath, setSelectedDirectoryPath]);

  // Global hotkey: Ctrl+Shift+C toggles the Commander overlay. With Shift held
  // `e.key` is uppercase "C"; accept both cases defensively.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        toggleCommander();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleCommander]);

  // When Commander resolves a project scope, select that directory so the
  // sidebar navigates to it.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onCommanderNavigate((path) => setSelectedDirectoryPath(path)).then(
      (fn) => {
        if (disposed) fn();
        else unlisten = fn;
      },
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setSelectedDirectoryPath]);

  // When Commander adds/removes a directory via its MCP tools, the backend only
  // mutated the persisted store — reload the list so the change shows up in the
  // sidebar live instead of waiting for the next mount.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onCommanderDirectoriesChanged(() => void loadDirectories()).then(
      (fn) => {
        if (disposed) fn();
        else unlisten = fn;
      },
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadDirectories]);

  return (
    <div className="app-shell">
      <StatusEngine />
      <ErrorBoundary label="Title bar">
        <TitleBar />
      </ErrorBoundary>
      <div className="app-body">
        {/* Commander lives inside the body so its absolute fill stops at the
            top of the usage footer instead of overlapping it. Each region is
            boundaried so one panel's render error can't blank the whole app. */}
        <ErrorBoundary label="Commander">
          <Commander
            open={commanderOpen}
            onClose={() => setCommanderOpen(false)}
            engine={engine}
          />
        </ErrorBoundary>
        {/* Settings lives here (not in the Sidebar) so its `right: 0` absolute
            position resolves against the full-width `.app-body` and the drawer
            slides in from the true right edge — matching Commander. */}
        <ErrorBoundary label="Settings">
          <Settings
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </ErrorBoundary>
        <aside className="sidebar" aria-label="Workspaces">
          <ErrorBoundary label="Workspaces">
            <Sidebar />
          </ErrorBoundary>
        </aside>
        <main className="workspace" aria-label="Workspace">
          <ErrorBoundary label="Workspace">
            <Workspace />
          </ErrorBoundary>
        </main>
      </div>
      <ErrorBoundary label="Usage meter">
        <UsageBar />
      </ErrorBoundary>
    </div>
  );
}

export default App;
