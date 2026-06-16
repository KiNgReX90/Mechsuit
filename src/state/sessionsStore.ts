/**
 * Store for per-directory PTY sessions.
 *
 * Sessions are keyed by their owning directory path so that switching the
 * selected directory swaps which sessions are visible WITHOUT destroying
 * sessions spawned for other directories. The ipc layer (`spawnSession`,
 * `listSessions`) is wrapped here and mocked in tests.
 */
import { create } from "zustand";

import { killSession, listSessions, spawnSession } from "../ipc/commands";
import type { SessionInfo } from "../types";

export interface SessionsState {
  /** Sessions keyed by their owning directory path. */
  sessionsByDirectory: Record<string, SessionInfo[]>;

  /**
   * Populate the given directory's sessions from `listSessions` (filtered to
   * that directory). Other directories' sessions are left untouched.
   */
  loadDirectory: (dirPath: string) => Promise<void>;

  /**
   * Spawn a new session rooted at `dirPath` and append it to that directory's
   * list, preserving every other directory's sessions. Returns the new info.
   */
  addSession: (dirPath: string) => Promise<SessionInfo>;

  /**
   * Kill a session via the ipc layer and remove it from its directory's list.
   * Other directories' sessions are left untouched (same copy-on-write pattern
   * as `addSession`). If `sessionId` is not present in the list the list is
   * left unchanged; `killSession` is still called.
   */
  removeSession: (dirPath: string, sessionId: string) => Promise<void>;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessionsByDirectory: {},

  loadDirectory: async (dirPath) => {
    const all = await listSessions();
    const forDir = all.filter((s) => s.dirPath === dirPath);
    set((state) => ({
      sessionsByDirectory: {
        ...state.sessionsByDirectory,
        [dirPath]: forDir,
      },
    }));
  },

  addSession: async (dirPath) => {
    const info = await spawnSession(dirPath);
    const existing = get().sessionsByDirectory[dirPath] ?? [];
    set((state) => ({
      sessionsByDirectory: {
        ...state.sessionsByDirectory,
        [dirPath]: [...existing, info],
      },
    }));
    return info;
  },

  removeSession: async (dirPath, sessionId) => {
    await killSession(sessionId);
    const existing = get().sessionsByDirectory[dirPath] ?? [];
    set((state) => ({
      sessionsByDirectory: {
        ...state.sessionsByDirectory,
        [dirPath]: existing.filter((s) => s.id !== sessionId),
      },
    }));
  },
}));
