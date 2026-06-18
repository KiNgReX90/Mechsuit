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
  reorderDirectories,
} from "../ipc/commands";
import { reorderForDrop } from "../lib/reorder";
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

  /**
   * Move the directory at `fromIndex` into the insertion `slot` (0..n, as
   * computed from the drag's cursor position). Updates local order immediately
   * for a snappy drop, then persists the new path order. A drop that does not
   * change order is a no-op (no state change, no ipc call). If persistence
   * rejects, re-`load`s from disk so the UI reflects the stored truth.
   */
  reorder: (fromIndex: number, slot: number) => Promise<void>;
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

  reorder: async (fromIndex, slot) => {
    const existing = get().directories;
    const next = reorderForDrop(existing, fromIndex, slot);
    if (next === existing) return; // drop did not change order
    set({ directories: next });
    try {
      await reorderDirectories(next.map((d) => d.path));
    } catch {
      // Persistence failed (e.g. a disk write error). Resync from the store so
      // the sidebar reflects the on-disk truth rather than a phantom order.
      await get().load();
    }
  },
}));
