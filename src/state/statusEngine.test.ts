import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the IPC event layer so no real Tauri backend is needed. Each subscribe
// helper captures its callback and hands back a recorded unlisten fn.
const outputUnlisten = vi.fn();
const exitUnlisten = vi.fn();
let outputCb: ((payload: { sessionId: string; data: string }) => void) | undefined;
let exitCb: ((payload: { sessionId: string; code: number }) => void) | undefined;

vi.mock("../ipc/events", () => ({
  onSessionOutput: vi.fn((cb: typeof outputCb) => {
    outputCb = cb;
    return Promise.resolve(outputUnlisten);
  }),
  onSessionExit: vi.fn((cb: typeof exitCb) => {
    exitCb = cb;
    return Promise.resolve(exitUnlisten);
  }),
}));

import { IDLE_DEBOUNCE_MS, useStatusEngine } from "./statusEngine";
import { useStatusStore } from "./statusStore";
import { useUiStore } from "./uiStore";

const initialStatusState = useStatusStore.getState();
const initialUiState = useUiStore.getState();

/** Mount the engine and flush the async subscription resolution. */
async function mountEngine() {
  const view = renderHook(() => useStatusEngine());
  // Let the onSessionOutput/onSessionExit promises resolve so unlisten handles
  // are recorded and the callbacks are live.
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

const SID = "session-1";
const statusOf = (id: string) => useStatusStore.getState().statusBySession[id]?.status;

describe("statusEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStatusStore.setState(initialStatusState, true);
    useUiStore.setState(initialUiState, true);
    outputCb = undefined;
    exitCb = undefined;
    outputUnlisten.mockClear();
    exitUnlisten.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes exactly once to output and exit", async () => {
    const events = await import("../ipc/events");
    await mountEngine();
    expect(events.onSessionOutput).toHaveBeenCalledTimes(1);
    expect(events.onSessionExit).toHaveBeenCalledTimes(1);
  });

  it("output → working, then settles to ready after the debounce", async () => {
    await mountEngine();

    act(() => outputCb!({ sessionId: SID, data: "compiling project...\n" }));
    expect(statusOf(SID)).toBe("working");

    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    expect(statusOf(SID)).toBe("ready");
  });

  it("resets the idle timer on each new output chunk", async () => {
    await mountEngine();

    act(() => outputCb!({ sessionId: SID, data: "step 1\n" }));
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS - 1));
    expect(statusOf(SID)).toBe("working");

    // Another chunk before the debounce elapses re-arms the timer.
    act(() => outputCb!({ sessionId: SID, data: "step 2\n" }));
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS - 1));
    expect(statusOf(SID)).toBe("working");

    act(() => vi.advanceTimersByTime(1));
    expect(statusOf(SID)).toBe("ready");
  });

  it("trailing approval prompt settles to awaiting-approval", async () => {
    await mountEngine();

    act(() =>
      outputCb!({
        sessionId: SID,
        data: "Do you want to proceed?\n  1. Yes\n  2. No\n",
      }),
    );
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    expect(statusOf(SID)).toBe("awaiting-approval");
  });

  it("a mid-stream error pattern sets error immediately, bypassing the debounce", async () => {
    await mountEngine();

    act(() => outputCb!({ sessionId: SID, data: "error: build failed\n" }));
    expect(statusOf(SID)).toBe("error");

    // No pending timer should later flip it away from error.
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    expect(statusOf(SID)).toBe("error");
  });

  it("exit code 0 → ready and clears the pending idle timer", async () => {
    await mountEngine();

    act(() => outputCb!({ sessionId: SID, data: "working...\n" }));
    expect(statusOf(SID)).toBe("working");

    act(() => exitCb!({ sessionId: SID, code: 0 }));
    expect(statusOf(SID)).toBe("ready");

    // The previously-armed idle timer must not fire and re-classify.
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    expect(statusOf(SID)).toBe("ready");
  });

  it("exit non-zero code → error", async () => {
    await mountEngine();

    act(() => outputCb!({ sessionId: SID, data: "working...\n" }));
    act(() => exitCb!({ sessionId: SID, code: 1 }));
    expect(statusOf(SID)).toBe("error");
  });

  it("acknowledges a blinking (prompted) ready session when it gains focus", async () => {
    await mountEngine();

    // The user prompted SID, so its completion blinks to alert (unacknowledged).
    act(() => outputCb!({ sessionId: SID, data: "thinking...\n" }));
    act(() => useStatusStore.getState().markPrompted(SID));
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    expect(statusOf(SID)).toBe("ready");
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(false);

    act(() => useUiStore.getState().setFocusedSessionId(SID));
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(true);
  });

  it("acknowledges a session that becomes ready (idle) while it is focused", async () => {
    await mountEngine();

    // Focus the session while it is still working — a no-op ack at this point.
    act(() => useUiStore.getState().setFocusedSessionId(SID));
    act(() => outputCb!({ sessionId: SID, data: "done\n" }));
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));

    expect(statusOf(SID)).toBe("ready");
    // The user was looking at it when it finished, so it is already acknowledged
    // (it must not blink for completion the user witnessed).
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(true);
  });

  it("acknowledges a focused session that exits ready (code 0)", async () => {
    await mountEngine();

    act(() => useUiStore.getState().setFocusedSessionId(SID));
    act(() => exitCb!({ sessionId: SID, code: 0 }));

    expect(statusOf(SID)).toBe("ready");
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(true);
  });

  it("leaves a freshly-ready UNPROMPTED session acknowledged (no blink) even when not focused", async () => {
    await mountEngine();

    // No prompt was ever submitted: a session that simply finished starting up
    // must NOT blink, even unfocused. Blinking is reserved for a completion the
    // user actually asked for (covered by the prompted re-alert test below).
    act(() => exitCb!({ sessionId: SID, code: 0 }));

    expect(statusOf(SID)).toBe("ready");
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(true);
  });

  it("an acknowledged background session does NOT re-alert on incidental output", async () => {
    await mountEngine();

    // Session finishes and the user focuses it: acknowledged (steady, no blink).
    act(() => outputCb!({ sessionId: SID, data: "done\n" }));
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    act(() => useUiStore.getState().setFocusedSessionId(SID));
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(true);

    // User switches focus away, so SID is now a background tile.
    act(() => useUiStore.getState().setFocusedSessionId("other"));

    // Incidental output (a focus-escape redraw, a live-UI tick) cycles it
    // working→ready with no new prompt. It must STAY acknowledged — switching
    // focus around must never make a seen tile blink again.
    act(() => outputCb!({ sessionId: SID, data: "\x1b[2K" }));
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    expect(statusOf(SID)).toBe("ready");
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(true);
  });

  it("re-alerts a background session on the next ready after a new prompt", async () => {
    await mountEngine();

    // Finish + acknowledge while focused, then move focus away.
    act(() => outputCb!({ sessionId: SID, data: "done\n" }));
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    act(() => useUiStore.getState().setFocusedSessionId(SID));
    act(() => useUiStore.getState().setFocusedSessionId("other"));
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(true);

    // User sends SID a fresh prompt (Terminal reports this), then it works and
    // finishes in the background: it must blink again to alert.
    act(() => useStatusStore.getState().markPrompted(SID));
    act(() => outputCb!({ sessionId: SID, data: "thinking...\n" }));
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    expect(statusOf(SID)).toBe("ready");
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(false);
  });

  it("focusing a non-ready session is a no-op", async () => {
    await mountEngine();

    act(() => outputCb!({ sessionId: SID, data: "still working\n" }));
    expect(statusOf(SID)).toBe("working");
    const before = useStatusStore.getState().statusBySession[SID]?.acknowledged;

    // Focusing a working session must not change its status or acknowledged flag
    // — there is nothing ready to acknowledge.
    act(() => useUiStore.getState().setFocusedSessionId(SID));
    expect(statusOf(SID)).toBe("working");
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(before);
  });

  it("tears down both subscriptions and the focus subscription on unmount", async () => {
    const view = await mountEngine();
    view.unmount();
    expect(outputUnlisten).toHaveBeenCalledTimes(1);
    expect(exitUnlisten).toHaveBeenCalledTimes(1);

    // After unmount, focus changes must no longer acknowledge. Arm a blinking
    // (prompted) ready so an acknowledgement would be observable if the focus
    // subscription were still live — it must stay unacknowledged.
    useStatusStore.getState().setStatus(SID, "working");
    useStatusStore.getState().markPrompted(SID);
    useStatusStore.getState().setStatus(SID, "ready");
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(false);
    act(() => useUiStore.getState().setFocusedSessionId(SID));
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(false);
  });
});
