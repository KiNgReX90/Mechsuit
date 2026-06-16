/**
 * Store for application settings (e.g. workspaceRoot).
 *
 * Wraps the settings ipc layer: `load` fetches and populates state from the
 * backend; `setWorkspaceRoot` persists via `setSettings` and updates local
 * state. The ipc layer is mocked in tests.
 */
import { create } from "zustand";

import { getSettings, setSettings } from "../ipc/commands";
import type { AppSettings } from "../types";

export interface SettingsState {
  settings: AppSettings;
  /** Fetch settings from the backend and replace local state. */
  load: () => Promise<void>;
  /** Persist a new workspaceRoot via the backend and update local state. */
  setWorkspaceRoot: (path: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { workspaceRoot: "" },

  load: async () => {
    const settings = await getSettings();
    set({ settings });
  },

  setWorkspaceRoot: async (path) => {
    const updated: AppSettings = { ...get().settings, workspaceRoot: path };
    await setSettings(updated);
    set({ settings: updated });
  },
}));
