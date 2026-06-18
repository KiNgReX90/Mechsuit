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
import type { SessionStatus } from "../types";
import { useStatusStore } from "./statusStore";
import { useUiStore } from "./uiStore";

/**
 * Quiet/idle debounce: time with no further output after which a "working"
 * session settles to its idle classification. Single, easily-overridable knob.
 */
export const IDLE_DEBOUNCE_MS = 2000;

/**
 * How long a prompted completion's tile blinks green before it auto-clears to
 * neutral. The blink alerts briefly, then stops on its own so a finished session
 * the user never returns to does not pulse forever. Focusing the tile clears it
 * sooner. Single source of truth for the 5s window (the CSS pulse just loops).
 */
export const READY_BLINK_MS = 5000;

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
    // Per-session pending blink-expiry timers: a blinking (prompted) ready tile
    // auto-acknowledges after READY_BLINK_MS so its green pulse stops on its own.
    const blinkTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const trailing = new Map<string, string>();
    let disposed = false;

    const clearTimer = (sessionId: string) => {
      const handle = timers.get(sessionId);
      if (handle !== undefined) {
        clearTimeout(handle);
        timers.delete(sessionId);
      }
    };

    const clearBlinkTimer = (sessionId: string) => {
      const handle = blinkTimers.get(sessionId);
      if (handle !== undefined) {
        clearTimeout(handle);
        blinkTimers.delete(sessionId);
      }
    };

    // Write a status, and if it is a *ready* transition on the currently-focused
    // session, acknowledge it at once: the user is looking at the session as it
    // finishes, so it must settle to steady green rather than blink for a
    // completion they already witnessed. A background (non-focused) session that
    // becomes ready blinks to alert only when the store armed it via a submitted
    // prompt; an unprompted startup settles steady (see statusStore.setStatus).
    const applyStatus = (sessionId: string, status: SessionStatus) => {
      useStatusStore.getState().setStatus(sessionId, status);
      if (
        status === "ready" &&
        useUiStore.getState().focusedSessionId === sessionId
      ) {
        useStatusStore.getState().acknowledge(sessionId);
      }
      // (Re)evaluate the blink window. A tile that just entered the blinking
      // state (ready + unacknowledged) auto-clears to neutral after
      // READY_BLINK_MS; any other transition cancels a pending expiry so a
      // session that goes back to work never acknowledges out from under itself.
      clearBlinkTimer(sessionId);
      const entry = useStatusStore.getState().statusBySession[sessionId];
      if (entry && entry.status === "ready" && !entry.acknowledged) {
        blinkTimers.set(
          sessionId,
          setTimeout(() => {
            blinkTimers.delete(sessionId);
            useStatusStore.getState().acknowledge(sessionId);
          }, READY_BLINK_MS),
        );
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
        applyStatus(sessionId, "error");
        return;
      }

      // Output means the session is working; (re)arm the idle debounce.
      applyStatus(sessionId, "working");
      clearTimer(sessionId);
      timers.set(
        sessionId,
        setTimeout(() => {
          timers.delete(sessionId);
          const tail = trailing.get(sessionId) ?? "";
          applyStatus(sessionId, classifyIdle(tail));
        }, IDLE_DEBOUNCE_MS),
      );
    };

    const handleExit = (sessionId: string, code: number) => {
      clearTimer(sessionId);
      applyStatus(sessionId, code === 0 ? "ready" : "error");
    };

    // Ack a session that gains focus while ready (focusing a non-ready session
    // is a no-op). Track the previous focus so we only act on transitions.
    let lastFocused = useUiStore.getState().focusedSessionId;
    const ackIfReady = (sessionId: string | null) => {
      if (!sessionId) return;
      const entry = useStatusStore.getState().statusBySession[sessionId];
      if (entry?.status === "ready") {
        clearBlinkTimer(sessionId);
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
      for (const handle of blinkTimers.values()) clearTimeout(handle);
      blinkTimers.clear();
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
