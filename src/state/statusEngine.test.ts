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

  it("acknowledges a ready session when it gains focus", async () => {
    await mountEngine();

    act(() => outputCb!({ sessionId: SID, data: "done\n" }));
    act(() => vi.advanceTimersByTime(IDLE_DEBOUNCE_MS));
    expect(statusOf(SID)).toBe("ready");
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(false);

    act(() => useUiStore.getState().setFocusedSessionId(SID));
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(true);
  });

  it("focusing a non-ready session is a no-op", async () => {
    await mountEngine();

    act(() => outputCb!({ sessionId: SID, data: "still working\n" }));
    expect(statusOf(SID)).toBe("working");

    act(() => useUiStore.getState().setFocusedSessionId(SID));
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(false);
  });

  it("tears down both subscriptions and the focus subscription on unmount", async () => {
    const view = await mountEngine();
    view.unmount();
    expect(outputUnlisten).toHaveBeenCalledTimes(1);
    expect(exitUnlisten).toHaveBeenCalledTimes(1);

    // After unmount, focus changes must no longer acknowledge.
    useStatusStore.getState().setStatus(SID, "ready");
    act(() => useUiStore.getState().setFocusedSessionId(SID));
    expect(useStatusStore.getState().statusBySession[SID]?.acknowledged).toBe(false);
  });
});
