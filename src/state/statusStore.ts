/**
 * Per-session derived status store.
 *
 * Keyed by sessionId (not dirPath) for O(1) tile lookups. Contains purely
 * state and actions — no output parsing, no timers, no IPC subscriptions.
 * Those concerns live in status-parser and status-engine respectively.
 */
import { create } from "zustand";

import type { SessionStatus, SessionStatusState } from "../types";

export interface StatusStoreState {
  /** Derived status for each live session, keyed by sessionId. */
  statusBySession: Record<string, SessionStatusState>;

  /**
   * Upsert a session's status. Transitioning to "ready" resets `acknowledged`
   * to false so a fresh ready always re-alerts.
   */
  setStatus: (sessionId: string, status: SessionStatus) => void;

  /**
   * Mark a session's ready state as acknowledged (e.g. user focused the tile).
   * No-op if the session is not tracked.
   */
  acknowledge: (sessionId: string) => void;

  /**
   * Remove a session's entry entirely (called when a session is killed/removed).
   * No-op if the session is not tracked.
   */
  clear: (sessionId: string) => void;
}

export const useStatusStore = create<StatusStoreState>((set, get) => ({
  statusBySession: {},

  setStatus: (sessionId, status) => {
    const existing = get().statusBySession[sessionId];
    const acknowledged = status === "ready" ? false : (existing?.acknowledged ?? false);
    set((state) => ({
      statusBySession: {
        ...state.statusBySession,
        [sessionId]: { status, acknowledged },
      },
    }));
  },

  acknowledge: (sessionId) => {
    const existing = get().statusBySession[sessionId];
    if (!existing) return;
    set((state) => ({
      statusBySession: {
        ...state.statusBySession,
        [sessionId]: { ...existing, acknowledged: true },
      },
    }));
  },

  clear: (sessionId) => {
    set((state) => {
      const next = { ...state.statusBySession };
      delete next[sessionId];
      return { statusBySession: next };
    });
  },
}));
