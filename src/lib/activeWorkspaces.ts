/**
 * Active-workspaces data hook.
 *
 * The collected view needs to see EVERY managed directory's sessions at once,
 * not just the selected one (which `<Workspace>` loads on its own). This hook
 * loads sessions for all managed directories on mount (and again whenever the
 * directory list grows) by reusing `sessionsStore.loadDirectory` — idempotent,
 * order-preserving, and crucially NON-destructive: it never disposes or
 * re-spawns a terminal. It then derives, reactively from `directories` +
 * `sessionsByDirectory`, the set of directories that currently have at least one
 * live session, each paired with its `DirectoryInfo` and `SessionInfo[]`.
 *
 * Pure data/composition: no UI, no new IPC. The return shape is the contract
 * `wi-04` (the collected view) consumes.
 */
import { useEffect, useMemo } from "react";

import { useDirectoriesStore } from "../state/directoriesStore";
import { useSessionsStore } from "../state/sessionsStore";
import type { DirectoryInfo, SessionInfo } from "../types";

/** A managed directory that currently has at least one live session. */
export interface ActiveWorkspace {
  directory: DirectoryInfo;
  sessions: SessionInfo[];
}

/**
 * Load every managed directory's sessions and return the active subset.
 *
 * Returns directories with ≥1 live session, paired with their `DirectoryInfo`
 * and `SessionInfo[]`, ordered by the directory-list order. The result
 * recomputes whenever the directory list or any directory's sessions change, so
 * bays appear and disappear live as sessions spawn and exit — no manual refresh.
 */
export function useActiveWorkspaces(): ActiveWorkspace[] {
  const directories = useDirectoriesStore((s) => s.directories);
  const loadDirectories = useDirectoriesStore((s) => s.load);
  const sessionsByDirectory = useSessionsStore((s) => s.sessionsByDirectory);
  const loadDirectory = useSessionsStore((s) => s.loadDirectory);

  // Ensure the managed directory list is loaded before fanning out, so a fresh
  // mount (empty list) still discovers every directory's sessions.
  useEffect(() => {
    void loadDirectories().catch(() => {
      // Best-effort: a failed directory list must not crash the collected view;
      // it simply renders no bays until the list loads.
    });
  }, [loadDirectories]);

  // Load sessions for every managed directory. Re-runs when the directory list
  // changes so a newly-added directory's sessions are picked up too; reloading
  // an already-loaded directory is a harmless, order-preserving reconcile.
  useEffect(() => {
    for (const dir of directories) {
      void loadDirectory(dir.path).catch(() => {
        // Best-effort per directory: one directory failing to list its sessions
        // must not prevent the others from loading.
      });
    }
  }, [directories, loadDirectory]);

  // Derive the active set in directory-list order. Filtering to ≥1 live session
  // happens here, off the raw store maps, so the result recomputes whenever
  // either input changes (a directory dropping to zero is excluded; a
  // previously-empty one gaining a session is included) while ordering stays
  // tied to the stable directory order.
  return useMemo(() => {
    const active: ActiveWorkspace[] = [];
    for (const directory of directories) {
      const sessions = sessionsByDirectory[directory.path] ?? [];
      if (sessions.length >= 1) {
        active.push({ directory, sessions });
      }
    }
    return active;
  }, [directories, sessionsByDirectory]);
}
