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

import { startSubagentEngine, useSubagentEngine } from "./subagentEngine";
import { useSubagentStore } from "./subagentStore";

const initialStoreState = useSubagentStore.getState();
const SID = "session-1";
const subsOf = (id: string) => useSubagentStore.getState().subagentsBySession[id];

/** Start the engine and flush the async subscription resolution. */
async function startEngine() {
  const dispose = startSubagentEngine();
  await Promise.resolve();
  return dispose;
}

describe("subagentEngine", () => {
  beforeEach(() => {
    useSubagentStore.setState(initialStoreState, true);
    outputCb = undefined;
    exitCb = undefined;
    outputUnlisten.mockClear();
    exitUnlisten.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subscribes exactly once to output and exit", async () => {
    const events = await import("../ipc/events");
    const dispose = await startEngine();
    expect(events.onSessionOutput).toHaveBeenCalledTimes(1);
    expect(events.onSessionExit).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("detects a Task in the output stream and writes the store keyed by sessionId", async () => {
    const dispose = await startEngine();
    outputCb!({ sessionId: SID, data: "● Task(Explore the codebase)\n  ⎿ Running…\n" });
    const subs = subsOf(SID);
    expect(subs).toHaveLength(1);
    expect(subs[0].label).toBe("Explore the codebase");
    expect(subs[0].status).toBe("working");
    dispose();
  });

  it("maps done→ready and failed→error as the Task block resolves", async () => {
    const dispose = await startEngine();
    outputCb!({ sessionId: SID, data: "● Task(Find bug)\n  ⎿ Done (2 tool uses)\n" });
    expect(subsOf(SID)[0].status).toBe("ready");

    outputCb!({ sessionId: "session-2", data: "● Task(Risky)\n  ⎿ Error: boom\n" });
    expect(subsOf("session-2")[0].status).toBe("error");
    dispose();
  });

  it("attributes subagents per session — two sessions never cross-attribute", async () => {
    const dispose = await startEngine();
    outputCb!({ sessionId: "a", data: "● Task(For A)\n  ⎿ Running…\n" });
    outputCb!({ sessionId: "b", data: "● Task(For B)\n  ⎿ Running…\n" });
    expect(subsOf("a").map((s) => s.label)).toEqual(["For A"]);
    expect(subsOf("b").map((s) => s.label)).toEqual(["For B"]);
    dispose();
  });

  it("never creates an entry for plain-shell output", async () => {
    const dispose = await startEngine();
    outputCb!({ sessionId: SID, data: "$ ls\ntotal 4\n$ npm test\n" });
    expect(subsOf(SID)).toBeUndefined();
    dispose();
  });

  it("clears a session entirely on exit", async () => {
    const dispose = await startEngine();
    outputCb!({ sessionId: SID, data: "● Task(Work)\n  ⎿ Running…\n" });
    expect(subsOf(SID)).toBeDefined();

    exitCb!({ sessionId: SID, code: 0 });
    expect(subsOf(SID)).toBeUndefined();
    dispose();
  });

  it("clears a session on a non-zero exit too", async () => {
    const dispose = await startEngine();
    outputCb!({ sessionId: SID, data: "● Task(Work)\n  ⎿ Running…\n" });
    exitCb!({ sessionId: SID, code: 1 });
    expect(subsOf(SID)).toBeUndefined();
    dispose();
  });

  it("operates on a bounded trailing buffer — Tasks that scroll out are dropped", async () => {
    const dispose = await startEngine();
    outputCb!({ sessionId: SID, data: "● Task(Old one)\n  ⎿ Done\n" });
    expect(subsOf(SID)).toHaveLength(1);

    // Flood the buffer with more than its capacity of plain output, pushing the
    // Task header out of the bounded tail. The list must reflect no live subagents.
    outputCb!({ sessionId: SID, data: "x".repeat(10_000) });
    expect(subsOf(SID)).toEqual([]);
    dispose();
  });

  it("tears down both subscriptions on dispose", async () => {
    const dispose = await startEngine();
    dispose();
    expect(outputUnlisten).toHaveBeenCalledTimes(1);
    expect(exitUnlisten).toHaveBeenCalledTimes(1);
  });

  it("the useSubagentEngine hook starts and tears the engine down on unmount", async () => {
    const view = renderHook(() => useSubagentEngine());
    await act(async () => {
      await Promise.resolve();
    });
    expect(outputUnlisten).not.toHaveBeenCalled();
    view.unmount();
    expect(outputUnlisten).toHaveBeenCalledTimes(1);
    expect(exitUnlisten).toHaveBeenCalledTimes(1);
  });
});
