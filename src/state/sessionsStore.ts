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
import { disposeTerminal } from "../lib/terminalPool";
import { generateSessionName } from "../lib/sessionName";
import type { SessionInfo } from "../types";

export interface SessionsState {
  /** Sessions keyed by their owning directory path. */
  sessionsByDirectory: Record<string, SessionInfo[]>;

  /**
   * Human-friendly codename for each session, keyed by sessionId. Assigned once
   * at spawn (and backfilled for sessions surfaced by `loadDirectory`), then
   * held stable for the session's lifetime so a tile always reads the same name.
   * Unique across all directories; dropped when the session is removed.
   */
  namesBySession: Record<string, string>;

  /**
   * Reconcile the given directory's sessions against `listSessions` (filtered to
   * that directory) WITHOUT reordering the tiles the user already sees. The
   * backend lists sessions in `HashMap` iteration order, which reshuffles on any
   * spawn/exit, so `loadDirectory` re-reads it on every switch; preserving the
   * known order keeps tiles put. Other directories' sessions are untouched.
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
  namesBySession: {},

  loadDirectory: async (dirPath) => {
    const all = await listSessions();
    const forDir = all.filter((s) => s.dirPath === dirPath && s.kind !== "commander");
    set((state) => {
      const prev = state.sessionsByDirectory[dirPath] ?? [];
      const byId = new Map(forDir.map((s) => [s.id, s]));
      // Keep already-shown sessions in their existing slots (dropping any that
      // vanished), then append newly-discovered ones in a stable order so the
      // first sighting of a session is deterministic regardless of backend
      // iteration order.
      const ordered: SessionInfo[] = [];
      for (const known of prev) {
        const current = byId.get(known.id);
        if (current) {
          ordered.push(current);
          byId.delete(known.id);
        }
      }
      const fresh = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
      const finalList = [...ordered, ...fresh];
      // Ensure every surfaced session carries a stable codename. Existing names
      // are kept; only sessions seen for the first time get a fresh, unique one.
      const namesBySession = { ...state.namesBySession };
      for (const s of finalList) {
        if (!namesBySession[s.id]) {
          namesBySession[s.id] = generateSessionName(Object.values(namesBySession));
        }
      }
      return {
        sessionsByDirectory: {
          ...state.sessionsByDirectory,
          [dirPath]: finalList,
        },
        namesBySession,
      };
    });
  },

  addSession: async (dirPath) => {
    const info = await spawnSession(dirPath);
    const { sessionsByDirectory, namesBySession } = get();
    const existing = sessionsByDirectory[dirPath] ?? [];
    const name = generateSessionName(Object.values(namesBySession));
    set((state) => ({
      sessionsByDirectory: {
        ...state.sessionsByDirectory,
        [dirPath]: [...existing, info],
      },
      namesBySession: { ...state.namesBySession, [info.id]: name },
    }));
    return info;
  },

  removeSession: async (dirPath, sessionId) => {
    await killSession(sessionId);
    // The session is gone for good — tear down its pooled xterm instance (kept
    // alive across workspace switches) so it does not leak.
    disposeTerminal(sessionId);
    const existing = get().sessionsByDirectory[dirPath] ?? [];
    set((state) => {
      const namesBySession = { ...state.namesBySession };
      delete namesBySession[sessionId];
      return {
        sessionsByDirectory: {
          ...state.sessionsByDirectory,
          [dirPath]: existing.filter((s) => s.id !== sessionId),
        },
        namesBySession,
      };
    });
  },
}));
