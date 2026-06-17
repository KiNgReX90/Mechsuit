/**
 * Tracks which sessions are currently OS-suspended (paused), so tiles can show a
 * paused state. Fed by the `session://paused` subscription in App.
 */
import { create } from "zustand";

export interface PausedState {
  /** Ids of sessions currently paused. */
  pausedIds: Set<string>;
  /** Mark a session paused (true) or resumed (false). */
  setPaused: (sessionId: string, paused: boolean) => void;
}

export const usePausedStore = create<PausedState>((set) => ({
  pausedIds: new Set<string>(),
  setPaused: (sessionId, paused) =>
    set((state) => {
      const next = new Set(state.pausedIds);
      if (paused) next.add(sessionId);
      else next.delete(sessionId);
      return { pausedIds: next };
    }),
}));
