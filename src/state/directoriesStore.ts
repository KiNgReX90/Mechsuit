/**
 * Store for the managed directory list shown in the sidebar.
 *
 * Holds the loaded `DirectoryInfo[]` plus actions that wrap the ipc command
 * layer: `load` populates the list (called on Sidebar mount) and `add` appends
 * a newly resolved directory. The ipc layer is mocked in tests.
 */
import { create } from "zustand";

import {
  addDirectory,
  listDirectories,
  removeDirectory,
} from "../ipc/commands";
import type { DirectoryInfo } from "../types";

export interface DirectoriesState {
  directories: DirectoryInfo[];
  /** Fetch the managed directory list and replace local state. */
  load: () => Promise<void>;
  /** Add a directory by path; appends the resolved info to the list. */
  add: (path: string) => Promise<void>;
  /**
   * Remove a directory by path: calls the existing `removeDirectory` ipc and
   * drops the entry from local state. Mirrors `add`; a no-op for an unknown
   * path beyond invoking the command.
   */
  remove: (path: string) => Promise<void>;
}

export const useDirectoriesStore = create<DirectoriesState>((set, get) => ({
  directories: [],

  load: async () => {
    const directories = await listDirectories();
    set({ directories });
  },

  add: async (path) => {
    const info = await addDirectory(path);
    const existing = get().directories;
    if (existing.some((d) => d.path === info.path)) {
      return;
    }
    set({ directories: [...existing, info] });
  },

  remove: async (path) => {
    await removeDirectory(path);
    const existing = get().directories;
    set({ directories: existing.filter((d) => d.path !== path) });
  },
}));
