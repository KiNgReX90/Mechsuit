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
   * Upsert a session's status. Transitioning to "ready" re-alerts (resets
   * `acknowledged` to false) ONLY when a prompt was submitted since the last
   * acknowledgement (`promptedSinceAck`); otherwise an already-seen session
   * keeps its acknowledged state, so incidental output (focus-escape redraws,
   * live-UI ticks) never makes it blink again. A brand-new session defaults to
   * acknowledged, so its first ready (a startup the user never prompted) is
   * steady, not blinking — blinking is reserved for a completion the user asked
   * for via {@link markPrompted}.
   */
  setStatus: (sessionId: string, status: SessionStatus) => void;

  /**
   * Mark a session's ready state as acknowledged (e.g. user focused the tile),
   * and clear any pending prompt so it cannot re-arm a future ready. No-op if
   * the session is not tracked.
   */
  acknowledge: (sessionId: string) => void;

  /**
   * Record that the user submitted a prompt/command to the session (e.g. an
   * Enter keystroke). Arms a re-alert: the next transition to "ready" will
   * blink even if the session was previously acknowledged. No-op if the session
   * is not tracked.
   */
  markPrompted: (sessionId: string) => void;

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
    // Blinking is armed EXCLUSIVELY by a submitted prompt: a ready re-alerts
    // (drops acknowledged) only when a fresh prompt is outstanding. Otherwise it
    // keeps the prior acknowledged, which DEFAULTS TO TRUE for a never-seen
    // session — so a freshly-opened session's first ready settles to steady
    // (no blink) rather than nagging about a startup the user never asked for.
    // Reaching ready consumes the prompt so a second incidental cycle won't
    // re-alert. An already-blinking session keeps its false until acknowledged.
    const prompted = existing?.promptedSinceAck ?? false;
    const acknowledged =
      status === "ready" ? (prompted ? false : (existing?.acknowledged ?? true)) : (existing?.acknowledged ?? true);
    const promptedSinceAck = status === "ready" ? false : prompted;
    set((state) => ({
      statusBySession: {
        ...state.statusBySession,
        [sessionId]: { status, acknowledged, promptedSinceAck },
      },
    }));
  },

  acknowledge: (sessionId) => {
    const existing = get().statusBySession[sessionId];
    if (!existing) return;
    set((state) => ({
      statusBySession: {
        ...state.statusBySession,
        [sessionId]: { ...existing, acknowledged: true, promptedSinceAck: false },
      },
    }));
  },

  markPrompted: (sessionId) => {
    const existing = get().statusBySession[sessionId];
    if (!existing) return;
    set((state) => ({
      statusBySession: {
        ...state.statusBySession,
        [sessionId]: { ...existing, promptedSinceAck: true },
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
