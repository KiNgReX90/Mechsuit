/**
 * UI selection state: which directory is selected, which session has input
 * focus, and which session (if any) is expanded to fill the workspace.
 *
 * This store is complete; feature items consume it but should not duplicate
 * selection state elsewhere.
 */
import { create } from "zustand";

export interface UiState {
  /** Path of the directory whose workspace is open, or null for none. */
  selectedDirectoryPath: string | null;
  /** Id of the session that receives keyboard input, or null for none. */
  focusedSessionId: string | null;
  /** Id of the session expanded to fill the workspace, or null for the grid. */
  expandedSessionId: string | null;
  /** Whether the Commander drawer is open. Closed by default on startup. */
  commanderOpen: boolean;
  /** Whether the Settings drawer is open. Closed by default. */
  settingsOpen: boolean;
  /** Whether the sessions graph screen is open. Closed by default. */
  graphOpen: boolean;

  setSelectedDirectoryPath: (path: string | null) => void;
  setFocusedSessionId: (sessionId: string | null) => void;
  setExpandedSessionId: (sessionId: string | null) => void;
  setCommanderOpen: (open: boolean) => void;
  toggleCommander: () => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSettings: () => void;
  setGraphOpen: (open: boolean) => void;
  toggleGraph: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedDirectoryPath: null,
  focusedSessionId: null,
  expandedSessionId: null,
  commanderOpen: false,
  settingsOpen: false,
  graphOpen: false,

  setSelectedDirectoryPath: (path) => set({ selectedDirectoryPath: path }),
  setFocusedSessionId: (sessionId) => set({ focusedSessionId: sessionId }),
  setExpandedSessionId: (sessionId) => set({ expandedSessionId: sessionId }),
  setCommanderOpen: (open) => set({ commanderOpen: open }),
  toggleCommander: () =>
    set((state) => ({ commanderOpen: !state.commanderOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),
  setGraphOpen: (open) => set({ graphOpen: open }),
  toggleGraph: () => set((state) => ({ graphOpen: !state.graphOpen })),
}));
