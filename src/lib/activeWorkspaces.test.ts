/**
 * useActiveWorkspaces hook tests (RTL renderHook + Vitest, ipc mocked).
 *
 * Covers the one new mechanic behind the collected view:
 *  - on mount it loads sessions for EVERY managed directory (not just the
 *    selected one), reusing the real sessionsStore.loadDirectory over the
 *    directoriesStore list;
 *  - it returns only directories with >=1 live session, each paired with its
 *    DirectoryInfo and SessionInfo[];
 *  - the result recomputes reactively when sessions are added/removed, with a
 *    directory dropping to zero excluded and a previously-empty one gaining a
 *    session included;
 *  - ordering follows the directory-list order and stays stable across
 *    recomputes.
 *
 * The ipc layer is mocked exactly as the existing store tests do; the stores'
 * own reconcile logic runs for real so we exercise the genuine composition.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../ipc/commands";
import { useDirectoriesStore } from "../state/directoriesStore";
import { useSessionsStore } from "../state/sessionsStore";
import type { DirectoryInfo, SessionInfo } from "../types";
import { useActiveWorkspaces } from "./activeWorkspaces";

vi.mock("../ipc/commands");
// loadDirectory's reconcile never touches the pool, but addSession/removeSession
// in the store import it; stub so nothing reaches xterm/DOM.
vi.mock("./terminalPool", () => ({ disposeTerminal: vi.fn() }));

const mockedCommands = vi.mocked(commands);

const DIR_A = "/home/ruben/alpha";
const DIR_B = "/home/ruben/bravo";
const DIR_C = "/home/ruben/charlie";

function dir(path: string, branch: string | null = "main"): DirectoryInfo {
  return {
    path,
    name: path.split("/").pop() ?? path,
    isGitRepo: branch !== null,
    branch,
    repo: branch !== null ? (path.split("/").pop() ?? null) : null,
    lastModified: null,
  };
}

function session(id: string, dirPath: string): SessionInfo {
  return { id, dirPath, kind: "workspace" };
}

/**
 * Drive listSessions to return the given live sessions across all directories.
 * The store filters by dirPath, so one flat list serves every loadDirectory.
 */
function setLiveSessions(sessions: SessionInfo[]) {
  mockedCommands.listSessions.mockResolvedValue(sessions);
}

/**
 * Flush the chain the hook kicks off on mount: directoriesStore.load resolves,
 * its state update re-runs the fan-out effect, each directory's loadDirectory
 * resolves, and React re-renders the memo. Yielding the microtask queue a few
 * times settles every link without depending on a single fixed depth.
 */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  useDirectoriesStore.setState({ directories: [] });
  useSessionsStore.setState({ sessionsByDirectory: {}, namesBySession: {} });
  setLiveSessions([]);
  // The hook's mount effect calls directoriesStore.load() -> listDirectories.
  // Default it to echo the currently-preset directory list so a test that seeds
  // `directories` directly is not clobbered by an undefined/empty ipc result.
  // Tests that exercise the "load the list first" path override this.
  mockedCommands.listDirectories.mockImplementation(async () =>
    useDirectoriesStore.getState().directories,
  );
});

afterEach(cleanup);

describe("useActiveWorkspaces", () => {
  it("loads sessions for EVERY managed directory on mount, not just one", async () => {
    useDirectoriesStore.setState({
      directories: [dir(DIR_A), dir(DIR_B), dir(DIR_C)],
    });

    // Resolve the directory list load + the per-directory session loads.
    await act(async () => {
      renderHook(() => useActiveWorkspaces());
      await settle();
    });

    // loadDirectory fans out to listSessions for each managed directory.
    expect(mockedCommands.listSessions).toHaveBeenCalled();
    const loaded = Object.keys(useSessionsStore.getState().sessionsByDirectory);
    expect(loaded).toEqual(expect.arrayContaining([DIR_A, DIR_B, DIR_C]));
  });

  it("ensures the directory list is loaded before fanning out", async () => {
    // Store starts empty; the hook must pull the list via the ipc layer.
    mockedCommands.listDirectories.mockResolvedValue([dir(DIR_A)]);
    setLiveSessions([session("a1", DIR_A)]);

    let result!: ReturnType<typeof renderHook<ReturnType<typeof useActiveWorkspaces>, unknown>>["result"];
    await act(async () => {
      ({ result } = renderHook(() => useActiveWorkspaces()));
      await settle();
    });

    expect(mockedCommands.listDirectories).toHaveBeenCalled();
    expect(result.current.map((w) => w.directory.path)).toEqual([DIR_A]);
  });

  it("returns only directories with >=1 live session, each with its info and sessions", async () => {
    useDirectoriesStore.setState({
      directories: [dir(DIR_A, "feature"), dir(DIR_B, null), dir(DIR_C, "main")],
    });
    // A and C are active; B has no sessions.
    setLiveSessions([
      session("a1", DIR_A),
      session("a2", DIR_A),
      session("c1", DIR_C),
    ]);

    let result!: { current: ReturnType<typeof useActiveWorkspaces> };
    await act(async () => {
      ({ result } = renderHook(() => useActiveWorkspaces()));
      await settle();
    });

    const active = result.current;
    expect(active.map((w) => w.directory.path)).toEqual([DIR_A, DIR_C]);

    const [first, second] = active;
    expect(first.directory.branch).toBe("feature");
    expect(first.sessions.map((s) => s.id)).toEqual(["a1", "a2"]);
    expect(second.directory.path).toBe(DIR_C);
    expect(second.sessions.map((s) => s.id)).toEqual(["c1"]);
  });

  it("recomputes when a directory gains its first session (previously empty -> included)", async () => {
    useDirectoriesStore.setState({ directories: [dir(DIR_A), dir(DIR_B)] });
    setLiveSessions([session("a1", DIR_A)]);

    let result!: { current: ReturnType<typeof useActiveWorkspaces> };
    await act(async () => {
      ({ result } = renderHook(() => useActiveWorkspaces()));
      await settle();
    });
    expect(result.current.map((w) => w.directory.path)).toEqual([DIR_A]);

    // B spawns its first session — the active set must grow, live, no remount.
    setLiveSessions([session("a1", DIR_A), session("b1", DIR_B)]);
    await act(async () => {
      await useSessionsStore.getState().loadDirectory(DIR_B);
    });

    expect(result.current.map((w) => w.directory.path)).toEqual([DIR_A, DIR_B]);
  });

  it("recomputes when a directory drops to zero sessions (excluded)", async () => {
    useDirectoriesStore.setState({ directories: [dir(DIR_A), dir(DIR_B)] });
    setLiveSessions([session("a1", DIR_A), session("b1", DIR_B)]);

    let result!: { current: ReturnType<typeof useActiveWorkspaces> };
    await act(async () => {
      ({ result } = renderHook(() => useActiveWorkspaces()));
      await settle();
    });
    expect(result.current.map((w) => w.directory.path)).toEqual([DIR_A, DIR_B]);

    // B's only session exits; reloading B drops it from the active set.
    setLiveSessions([session("a1", DIR_A)]);
    await act(async () => {
      await useSessionsStore.getState().loadDirectory(DIR_B);
    });

    expect(result.current.map((w) => w.directory.path)).toEqual([DIR_A]);
  });

  it("keeps ordering tied to the directory list and stable across an unrelated spawn", async () => {
    useDirectoriesStore.setState({
      directories: [dir(DIR_A), dir(DIR_B), dir(DIR_C)],
    });
    setLiveSessions([session("a1", DIR_A), session("c1", DIR_C)]);

    let result!: { current: ReturnType<typeof useActiveWorkspaces> };
    await act(async () => {
      ({ result } = renderHook(() => useActiveWorkspaces()));
      await settle();
    });
    // A before C — directory-list order, not session/discovery order.
    expect(result.current.map((w) => w.directory.path)).toEqual([DIR_A, DIR_C]);

    // B (which sits between A and C) gains a session: it slots into its list
    // position; A and C keep their relative order — no reshuffle.
    setLiveSessions([
      session("a1", DIR_A),
      session("b1", DIR_B),
      session("c1", DIR_C),
    ]);
    await act(async () => {
      await useSessionsStore.getState().loadDirectory(DIR_B);
    });

    expect(result.current.map((w) => w.directory.path)).toEqual([
      DIR_A,
      DIR_B,
      DIR_C,
    ]);
  });
});
