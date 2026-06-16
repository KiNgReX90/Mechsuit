/**
 * Status engine — the single global owner of live session-status derivation.
 *
 * It subscribes EXACTLY ONCE to `session://output` and `session://exit` (via
 * `ipc/events`), derives each session's status through the pure parser plus an
 * idle debounce, writes results into `statusStore`, and acknowledges a session
 * when it gains focus while `ready`.
 *
 * The store stays passive (state + actions only) and the parser stays pure;
 * ALL timers and subscription lifecycle live here. Mount `<StatusEngine/>` (or
 * call `useStatusEngine()`) exactly once in the app shell.
 *
 * This is intentionally independent of `Terminal.tsx`, which keeps its own
 * per-pane output subscription for rendering — this subscription exists solely
 * to derive status, regardless of which workspace/directory is shown.
 */
import { useEffect } from "react";

import { onSessionExit, onSessionOutput } from "../ipc/events";
import { classifyIdle, matchesError } from "../lib/statusParser";
import { useStatusStore } from "./statusStore";
import { useUiStore } from "./uiStore";

/**
 * Quiet/idle debounce: time with no further output after which a "working"
 * session settles to its idle classification. Single, easily-overridable knob.
 */
export const IDLE_DEBOUNCE_MS = 2000;

/**
 * Upper bound on the trailing-output buffer kept per session for `classifyIdle`.
 * Only the tail matters to the heuristics, so we never accumulate the whole
 * stream — we keep at most the last ~2KB of characters.
 */
export const TRAILING_BUFFER_MAX = 2048;

/**
 * Run the status engine for the lifetime of the calling component. Subscribes
 * once on mount and tears everything (listeners, timers, store subscription)
 * down on unmount.
 */
export function useStatusEngine(): void {
  useEffect(() => {
    // Per-session pending idle timers and bounded trailing-output buffers.
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const trailing = new Map<string, string>();
    let disposed = false;

    const clearTimer = (sessionId: string) => {
      const handle = timers.get(sessionId);
      if (handle !== undefined) {
        clearTimeout(handle);
        timers.delete(sessionId);
      }
    };

    const handleOutput = (sessionId: string, data: string) => {
      // Append to the bounded trailing buffer (keep only the tail).
      const combined = (trailing.get(sessionId) ?? "") + data;
      trailing.set(
        sessionId,
        combined.length > TRAILING_BUFFER_MAX
          ? combined.slice(combined.length - TRAILING_BUFFER_MAX)
          : combined,
      );

      // A recognizable error signature wins immediately — no idle wait.
      if (matchesError(data)) {
        clearTimer(sessionId);
        useStatusStore.getState().setStatus(sessionId, "error");
        return;
      }

      // Output means the session is working; (re)arm the idle debounce.
      useStatusStore.getState().setStatus(sessionId, "working");
      clearTimer(sessionId);
      timers.set(
        sessionId,
        setTimeout(() => {
          timers.delete(sessionId);
          const tail = trailing.get(sessionId) ?? "";
          useStatusStore.getState().setStatus(sessionId, classifyIdle(tail));
        }, IDLE_DEBOUNCE_MS),
      );
    };

    const handleExit = (sessionId: string, code: number) => {
      clearTimer(sessionId);
      useStatusStore
        .getState()
        .setStatus(sessionId, code === 0 ? "ready" : "error");
    };

    // Ack a session that gains focus while ready (focusing a non-ready session
    // is a no-op). Track the previous focus so we only act on transitions.
    let lastFocused = useUiStore.getState().focusedSessionId;
    const ackIfReady = (sessionId: string | null) => {
      if (!sessionId) return;
      const entry = useStatusStore.getState().statusBySession[sessionId];
      if (entry?.status === "ready") {
        useStatusStore.getState().acknowledge(sessionId);
      }
    };
    const unsubscribeFocus = useUiStore.subscribe((state) => {
      const next = state.focusedSessionId;
      if (next !== lastFocused) {
        lastFocused = next;
        ackIfReady(next);
      }
    });

    // Subscribe once; resolve unlisten handles, tearing down if we unmounted
    // before the promises settled.
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    void onSessionOutput((payload) => handleOutput(payload.sessionId, payload.data)).then(
      (fn) => {
        if (disposed) fn();
        else unlistenOutput = fn;
      },
    );
    void onSessionExit((payload) => handleExit(payload.sessionId, payload.code)).then(
      (fn) => {
        if (disposed) fn();
        else unlistenExit = fn;
      },
    );

    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
      unsubscribeFocus();
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
      trailing.clear();
    };
  }, []);
}

/**
 * Null-rendering component wrapper so the engine can be dropped into the app
 * shell declaratively: `<StatusEngine/>`.
 */
export function StatusEngine(): null {
  useStatusEngine();
  return null;
}
