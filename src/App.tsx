import "./App.css";

import { useEffect, useMemo } from "react";

import { Commander } from "./components/Commander";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { commanderSend } from "./ipc/commands";
import { onCommanderDirectoriesChanged, onCommanderNavigate } from "./ipc/events";
import type { CommanderEngine } from "./lib/commander/types";
import { useDirectoriesStore } from "./state/directoriesStore";
import { StatusEngine } from "./state/statusEngine";
import { useUiStore } from "./state/uiStore";

/**
 * Root application shell: a two-pane flex layout.
 *  - `<aside>` left sidebar region — mounts the stub <Sidebar/>.
 *  - `<main>` workspace region — mounts the stub <Workspace/>.
 *  - `<StatusEngine/>` — null-rendering, app-wide status derivation; mounted
 *    once here so it runs regardless of which workspace is shown.
 *  - `<Commander/>` — chat overlay over the workspace, toggled by Ctrl+Shift+C
 *    and driven by `commanderOpen`. Its engine wraps the `commanderSend` IPC
 *    command. A `commander://navigate` event selects the resolved directory.
 * Feature items fill the stub components in later rounds.
 */
function App() {
  const commanderOpen = useUiStore((state) => state.commanderOpen);
  const setCommanderOpen = useUiStore((state) => state.setCommanderOpen);
  const toggleCommander = useUiStore((state) => state.toggleCommander);
  const setSelectedDirectoryPath = useUiStore(
    (state) => state.setSelectedDirectoryPath,
  );
  const loadDirectories = useDirectoriesStore((state) => state.load);

  // The real Commander engine: thin wrapper over the `commanderSend` IPC
  // command, satisfying the `CommanderEngine` interface the overlay codes to.
  const engine = useMemo<CommanderEngine>(
    () => ({ ask: (message, sessionId) => commanderSend(message, sessionId) }),
    [],
  );

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
      <Commander
        open={commanderOpen}
        onClose={() => setCommanderOpen(false)}
        engine={engine}
      />
      <aside className="sidebar" aria-label="Directories">
        <Sidebar />
      </aside>
      <main className="workspace" aria-label="Workspace">
        <Workspace />
      </main>
    </div>
  );
}

export default App;
