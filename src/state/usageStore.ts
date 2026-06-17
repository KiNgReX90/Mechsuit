/**
 * Usage store — holds the latest usage snapshot from the backend.
 *
 * Contains purely state and the `applyUpdate` action; no IPC subscriptions,
 * no timers, no rendering concerns. The usage-bar-ui item wires this to the
 * live `usage://updated` event stream.
 */
import { create } from "zustand";

import type { UsageSnapshot, UsageUpdate } from "../types";

export interface UsageStoreState {
  /** Latest usage snapshot; null before the first successful update. */
  snapshot: UsageSnapshot | null;

  /** Human-readable error from the last failed update; null when healthy. */
  error: string | null;

  /** `Date.now()` at the time of the last `applyUpdate` call; null initially. */
  lastUpdated: number | null;

  /**
   * Apply a `UsageUpdate` event payload. On success (`snapshot` present) sets
   * `snapshot` and clears `error`; on failure (`error` present) records the
   * `error` but **retains the last good snapshot** so a transient blip doesn't
   * blank the meter — only when there has never been a snapshot does it stay
   * null. Always stamps `lastUpdated`.
   */
  applyUpdate: (u: UsageUpdate) => void;
}

export const useUsageStore = create<UsageStoreState>((set) => ({
  snapshot: null,
  error: null,
  lastUpdated: null,

  applyUpdate: (u: UsageUpdate) => {
    if (u.snapshot !== null) {
      set({ snapshot: u.snapshot, error: null, lastUpdated: Date.now() });
    } else {
      // Retain the last good snapshot through a transient failure; only the
      // error and timestamp change. A meter that has loaded once stays shown.
      set((s) => ({
        snapshot: s.snapshot,
        error: u.error,
        lastUpdated: Date.now(),
      }));
    }
  },
}));
