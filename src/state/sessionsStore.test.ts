/**
 * sessionsStore unit tests (Vitest, ipc layer mocked).
 *
 * Covers removeSession: calls killSession with the id, drops exactly that
 * session from its directory, leaves siblings and other directories intact,
 * and is a no-op on the list when the id is not present (killSession still
 * called).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../ipc/commands";
import { listSessions } from "../ipc/commands";
import * as terminalPool from "../lib/terminalPool";
import { useSessionsStore } from "./sessionsStore";
import type { SessionInfo } from "../types";

vi.mock("../ipc/commands");
// The pool touches xterm/DOM; the store only needs to drive its disposal hook,
// so stub it and assert the wiring.
vi.mock("../lib/terminalPool", () => ({ disposeTerminal: vi.fn() }));

const mockedCommands = vi.mocked(commands);
const mockedPool = vi.mocked(terminalPool);

const DIR = "/home/ruben/repo";
const OTHER_DIR = "/home/ruben/notes";

const session = (id: string, dirPath = DIR): SessionInfo => ({ id, dirPath });

beforeEach(() => {
  vi.clearAllMocks();
  useSessionsStore.setState({ sessionsByDirectory: {} });
  mockedCommands.killSession.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("sessionsStore.removeSession", () => {
  it("calls killSession with the given sessionId", async () => {
    useSessionsStore.setState({
      sessionsByDirectory: { [DIR]: [session("s1"), session("s2")] },
    });

    await useSessionsStore.getState().removeSession(DIR, "s1");

    expect(mockedCommands.killSession).toHaveBeenCalledWith("s1");
  });

  it("removes exactly the closed session from its directory", async () => {
    useSessionsStore.setState({
      sessionsByDirectory: { [DIR]: [session("s1"), session("s2"), session("s3")] },
    });

    await useSessionsStore.getState().removeSession(DIR, "s2");

    const remaining = useSessionsStore.getState().sessionsByDirectory[DIR];
    expect(remaining).toHaveLength(2);
    expect(remaining.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("leaves other directories' sessions untouched", async () => {
    useSessionsStore.setState({
      sessionsByDirectory: {
        [DIR]: [session("s1"), session("s2")],
        [OTHER_DIR]: [session("o1", OTHER_DIR), session("o2", OTHER_DIR)],
      },
    });

    await useSessionsStore.getState().removeSession(DIR, "s1");

    const otherRemaining = useSessionsStore.getState().sessionsByDirectory[OTHER_DIR];
    expect(otherRemaining).toHaveLength(2);
    expect(otherRemaining.map((s) => s.id)).toEqual(["o1", "o2"]);
  });

  it("is a no-op on the list when the sessionId is not present (killSession still called)", async () => {
    useSessionsStore.setState({
      sessionsByDirectory: { [DIR]: [session("s1"), session("s2")] },
    });

    await useSessionsStore.getState().removeSession(DIR, "nonexistent");

    expect(mockedCommands.killSession).toHaveBeenCalledWith("nonexistent");
    const remaining = useSessionsStore.getState().sessionsByDirectory[DIR];
    expect(remaining).toHaveLength(2);
    expect(remaining.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("disposes the closed session's terminal pane so its xterm is torn down", async () => {
    useSessionsStore.setState({
      sessionsByDirectory: { [DIR]: [session("s1"), session("s2")] },
    });

    await useSessionsStore.getState().removeSession(DIR, "s1");

    expect(mockedPool.disposeTerminal).toHaveBeenCalledWith("s1");
  });

  it("handles removeSession on a directory not yet in the store without throwing", async () => {
    useSessionsStore.setState({ sessionsByDirectory: {} });

    await expect(
      useSessionsStore.getState().removeSession(DIR, "s1"),
    ).resolves.toBeUndefined();

    expect(mockedCommands.killSession).toHaveBeenCalledWith("s1");
  });
});

describe("sessionsStore.loadDirectory", () => {
  it("excludes the commander session from a directory's list", async () => {
    vi.mocked(listSessions).mockResolvedValue([
      { id: "w1", dirPath: "/repo", kind: "workspace" },
      { id: "cmd", dirPath: "/repo", kind: "commander" },
    ]);
    await useSessionsStore.getState().loadDirectory("/repo");
    const list = useSessionsStore.getState().sessionsByDirectory["/repo"];
    expect(list.map((s) => s.id)).toEqual(["w1"]);
  });

  it("preserves the existing tile order when the backend returns a different order", async () => {
    // The directory is already showing s1, s2, s3 (the order the user sees).
    useSessionsStore.setState({
      sessionsByDirectory: { [DIR]: [session("s1"), session("s2"), session("s3")] },
    });
    // The backend (HashMap iteration) hands them back reshuffled.
    vi.mocked(listSessions).mockResolvedValue([
      { id: "s3", dirPath: DIR },
      { id: "s1", dirPath: DIR },
      { id: "s2", dirPath: DIR },
    ]);

    await useSessionsStore.getState().loadDirectory(DIR);

    // Tiles must stay put — switching back never reorders them.
    const list = useSessionsStore.getState().sessionsByDirectory[DIR];
    expect(list.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("drops sessions that vanished and appends newly-discovered ones after the known set", async () => {
    useSessionsStore.setState({
      sessionsByDirectory: { [DIR]: [session("s1"), session("s2")] },
    });
    // s2 is gone; s3 and s4 are new. Backend order is arbitrary.
    vi.mocked(listSessions).mockResolvedValue([
      { id: "s4", dirPath: DIR },
      { id: "s1", dirPath: DIR },
      { id: "s3", dirPath: DIR },
    ]);

    await useSessionsStore.getState().loadDirectory(DIR);

    const list = useSessionsStore.getState().sessionsByDirectory[DIR];
    // Known survivor (s1) keeps its slot; new ones append in a stable order.
    expect(list.map((s) => s.id)).toEqual(["s1", "s3", "s4"]);
  });
});
