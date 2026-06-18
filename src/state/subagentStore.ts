/**
 * Per-session subagent store.
 *
 * Keyed by sessionId, holding the live one-level subagent list each session has
 * rendered (Claude Code Task invocations). Contains purely state and actions —
 * no output parsing, no timers, no IPC subscriptions. Those concerns live in
 * `subagentParser` and `subagentEngine` respectively. Mirrors `statusStore`.
 *
 * Consumed (and the engine started) by wi-04's graph liveness layer.
 */
import { create } from "zustand";

import type { SubagentNode } from "../types";

export interface SubagentStoreState {
  /** Live subagent list for each session, keyed by sessionId. */
  subagentsBySession: Record<string, SubagentNode[]>;

  /**
   * Replace a session's subagent list with `nodes`. The engine recomputes the
   * full list from its accumulated per-session state and writes it here, so this
   * is an authoritative set rather than an append.
   */
  set: (sessionId: string, nodes: SubagentNode[]) => void;

  /**
   * Remove a session's entry entirely (called on `session://exit`). No-op if the
   * session is not tracked.
   */
  clear: (sessionId: string) => void;
}

export const useSubagentStore = create<SubagentStoreState>((set) => ({
  subagentsBySession: {},

  set: (sessionId, nodes) => {
    set((state) => ({
      subagentsBySession: {
        ...state.subagentsBySession,
        [sessionId]: nodes,
      },
    }));
  },

  clear: (sessionId) => {
    set((state) => {
      if (!(sessionId in state.subagentsBySession)) return state;
      const next = { ...state.subagentsBySession };
      delete next[sessionId];
      return { subagentsBySession: next };
    });
  },
}));
