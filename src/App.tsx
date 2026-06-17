import "./App.css";

import { useCallback, useEffect, useRef, useState } from "react";

import { Commander } from "./components/Commander";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { UsageBar } from "./components/UsageBar";
import { Workspace } from "./components/Workspace";
import { spawnCommanderSession } from "./ipc/commands";
import { onCommanderDirectoriesChanged, onCommanderNavigate, onSessionExit, onSessionPaused } from "./ipc/events";
import { mostRecentlyModified } from "./lib/recentWorkspace";
import { disposeTerminal } from "./lib/terminalPool";
import { useDirectoriesStore } from "./state/directoriesStore";
import { StatusEngine } from "./state/statusEngine";
import { usePausedStore } from "./state/pausedStore";
import { useUiStore } from "./state/uiStore";

/**
 * Root application shell: a column of title bar, body, and usage footer.
 *  - `<TitleBar/>` — custom window chrome for the borderless window (drag
 *    region + minimize/maximize/close), pinned at the top of the shell.
 *  - `<aside>` left sidebar region — mounts the stub <Sidebar/>.
 *  - `<main>` workspace region — mounts the stub <Workspace/>.
 *  - `<StatusEngine/>` — null-rendering, app-wide status derivation; mounted
 *    once here so it runs regardless of which workspace is shown.
 *  - `<Commander/>` — terminal drawer over the workspace, toggled by Ctrl+Shift+C
 *    and driven by `commanderOpen`. Lazily spawns a Commander PTY session on
 *    first open; shows a relaunch button when the session exits.
 *  - `<UsageBar/>` — slim full-width footer pinned below the sidebar+workspace
 *    row; the single owner of the `usage://updated` subscription.
 * Feature items fill the stub components in later rounds.
 */
function App() {
  const setPaused = usePausedStore((s) => s.setPaused);
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

  const [commanderSessionId, setCommanderSessionId] = useState<string | null>(null);
  // Mirror the id into a ref so the exit subscription (registered once) can read
  // the current id without re-subscribing on every change.
  const commanderSessionIdRef = useRef<string | null>(null);
  commanderSessionIdRef.current = commanderSessionId;
  // True after Commander exits, so the open-effect does not auto-respawn behind
  // the relaunch button; cleared when the user (or first open) spawns.
  const commanderExitedRef = useRef(false);

  const openCommander = useCallback(async () => {
    commanderExitedRef.current = false;
    try {
      const info = await spawnCommanderSession();
      setCommanderSessionId(info.id);
    } catch {
      // Spawn failed (e.g. claude not on PATH): leave the drawer on its relaunch
      // state so the user can retry; never crash the shell.
      setCommanderSessionId(null);
      commanderExitedRef.current = true;
    }
  }, []);

  // Lazy spawn: the first time the drawer opens with no live session, spawn one.
  useEffect(() => {
    if (commanderOpen && commanderSessionId == null && !commanderExitedRef.current) {
      void openCommander();
    }
  }, [commanderOpen, commanderSessionId, openCommander]);

  // Clear the id when the Commander process exits, so the drawer shows relaunch.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onSessionExit(({ sessionId }) => {
      if (sessionId === commanderSessionIdRef.current) {
        setCommanderSessionId(null);
        commanderExitedRef.current = true;
        // The drawer drops the Terminal on exit; tear down its pooled xterm so
        // it does not outlive the dead session (relaunch spawns a fresh id).
        disposeTerminal(sessionId);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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

  // Mirror backend SIGSTOP/SIGCONT events into the pausedStore so tiles can dim.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onSessionPaused(({ sessionId, paused }) => setPaused(sessionId, paused)).then(
      (fn) => {
        if (disposed) fn();
        else unlisten = fn;
      },
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setPaused]);

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
            sessionId={commanderSessionId}
            onClose={() => setCommanderOpen(false)}
            onRelaunch={() => {
              setCommanderOpen(true);
              void openCommander();
            }}
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
