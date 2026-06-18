/**
 * graphStore unit tests (Vitest).
 *
 * Two layers, both with mocked IPC/events + mocked source stores:
 *  - `assembleGraph`: the pure tree-assembly function (no live stores), covering
 *    repo→worktree→terminal→subagent nesting, the dirPath↔worktree match with
 *    repo-root fallback, and status roll-up wiring.
 *  - `startGraphEngine`: the liveness layer — starts the subagent engine,
 *    refreshes worktrees via `listWorktrees`, and reassembles when a source
 *    store changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../ipc/commands";
import * as subagentEngine from "./subagentEngine";
import { useDirectoriesStore } from "./directoriesStore";
import { useSessionsStore } from "./sessionsStore";
import { useStatusStore } from "./statusStore";
import { useSubagentStore } from "./subagentStore";
import {
  assembleGraph,
  startGraphEngine,
  useGraphStore,
  type GraphInputs,
} from "./graphStore";
import type {
  DirectoryInfo,
  SessionInfo,
  SessionStatus,
  SessionStatusState,
  SubagentNode,
  WorktreeInfo,
} from "../types";

vi.mock("../ipc/commands");

const mockedCommands = vi.mocked(commands);

// ---- fixture builders -------------------------------------------------------

const dir = (path: string, name = path.split("/").pop()!): DirectoryInfo => ({
  path,
  name,
  isGitRepo: true,
  branch: "main",
  lastModified: null,
});

const session = (id: string, dirPath: string): SessionInfo => ({ id, dirPath });

const worktree = (
  path: string,
  branch: string | null,
  isPrimary = false,
): WorktreeInfo => ({ path, branch, head: "abc123", isPrimary, parentPath: null });

const statusState = (status: SessionStatus): SessionStatusState => ({
  status,
  acknowledged: true,
  promptedSinceAck: false,
});

const subagent = (id: string, label: string, status: SessionStatus): SubagentNode => ({
  id,
  label,
  status,
});

const emptyInputs = (over: Partial<GraphInputs> = {}): GraphInputs => ({
  directories: [],
  sessionsByDirectory: {},
  statusBySession: {},
  worktreesByRepo: {},
  subagentsBySession: {},
  ...over,
});

// ---- assembleGraph (pure) ---------------------------------------------------

describe("assembleGraph", () => {
  it("returns one repo root per managed directory, labelled by name", () => {
    const roots = assembleGraph(
      emptyInputs({ directories: [dir("/a", "alpha"), dir("/b", "beta")] }),
    );
    expect(roots.map((r) => ({ id: r.id, kind: r.kind, label: r.label }))).toEqual([
      { id: "/a", kind: "repo", label: "alpha" },
      { id: "/b", kind: "repo", label: "beta" },
    ]);
  });

  it("nests a session under the worktree whose path equals its dirPath", () => {
    const roots = assembleGraph(
      emptyInputs({
        directories: [dir("/repo", "repo")],
        worktreesByRepo: {
          "/repo": [worktree("/repo", "main", true), worktree("/repo/wt-feature", "feature")],
        },
        sessionsByDirectory: {
          "/repo": [session("s1", "/repo/wt-feature")],
        },
        statusBySession: { s1: statusState("working") },
      }),
    );

    const repo = roots[0];
    const featureWt = repo.children.find((c) => c.id === "/repo/wt-feature")!;
    expect(featureWt.kind).toBe("worktree");
    expect(featureWt.children.map((c) => c.id)).toEqual(["s1"]);
    expect(featureWt.children[0].kind).toBe("terminal");
  });

  it("falls back to the repo root when no worktree matches the session's dirPath", () => {
    const roots = assembleGraph(
      emptyInputs({
        directories: [dir("/repo", "repo")],
        worktreesByRepo: { "/repo": [worktree("/repo/wt-feature", "feature")] },
        // session sits directly at /repo, which is NOT a listed worktree path
        sessionsByDirectory: { "/repo": [session("s1", "/repo")] },
        statusBySession: { s1: statusState("ready") },
      }),
    );

    const repo = roots[0];
    // The unmatched terminal is a direct child of the repo root, after worktrees.
    const terminal = repo.children.find((c) => c.kind === "terminal");
    expect(terminal?.id).toBe("s1");
    // ...and is NOT under the worktree.
    const wt = repo.children.find((c) => c.kind === "worktree");
    expect(wt?.children).toEqual([]);
  });

  it("attaches a session's subagents as its terminal children", () => {
    const roots = assembleGraph(
      emptyInputs({
        directories: [dir("/repo", "repo")],
        sessionsByDirectory: { "/repo": [session("s1", "/repo")] },
        statusBySession: { s1: statusState("working") },
        subagentsBySession: {
          s1: [subagent("s1:sub-0", "explorer", "working"), subagent("s1:sub-1", "tester", "ready")],
        },
      }),
    );

    const terminal = roots[0].children.find((c) => c.id === "s1")!;
    expect(terminal.children.map((c) => ({ id: c.id, kind: c.kind, label: c.label }))).toEqual([
      { id: "s1:sub-0", kind: "subagent", label: "explorer" },
      { id: "s1:sub-1", kind: "subagent", label: "tester" },
    ]);
  });

  it("rolls up a worktree's status worst-wins from its terminal children", () => {
    const roots = assembleGraph(
      emptyInputs({
        directories: [dir("/repo", "repo")],
        worktreesByRepo: { "/repo": [worktree("/repo/wt", "feature")] },
        sessionsByDirectory: {
          "/repo": [session("s1", "/repo/wt"), session("s2", "/repo/wt")],
        },
        statusBySession: { s1: statusState("ready"), s2: statusState("error") },
      }),
    );

    const wt = roots[0].children.find((c) => c.id === "/repo/wt")!;
    // error > ready, so the worktree (and the repo) report error.
    expect(wt.status).toBe("error");
    expect(roots[0].status).toBe("error");
  });

  it("rolls a terminal's status up over its own status AND its subagents (worst-wins)", () => {
    const roots = assembleGraph(
      emptyInputs({
        directories: [dir("/repo", "repo")],
        sessionsByDirectory: { "/repo": [session("s1", "/repo")] },
        statusBySession: { s1: statusState("ready") },
        subagentsBySession: { s1: [subagent("s1:sub-0", "explorer", "working")] },
      }),
    );

    const terminal = roots[0].children.find((c) => c.id === "s1")!;
    // own=ready, subagent=working → working surfaces on the terminal.
    expect(terminal.status).toBe("working");
  });

  it("defaults a non-leaf with no descendants to ready", () => {
    const roots = assembleGraph(emptyInputs({ directories: [dir("/repo", "repo")] }));
    expect(roots[0].status).toBe("ready");
    expect(roots[0].children).toEqual([]);
  });

  it("labels a worktree by its branch, falling back to the path basename when null", () => {
    const roots = assembleGraph(
      emptyInputs({
        directories: [dir("/repo", "repo")],
        worktreesByRepo: {
          "/repo": [worktree("/repo", "main", true), worktree("/repo/detached", null)],
        },
      }),
    );
    const labels = roots[0].children.map((c) => c.label);
    expect(labels).toEqual(["main", "detached"]);
  });
});

// ---- startGraphEngine (liveness) -------------------------------------------

describe("startGraphEngine", () => {
  const directoriesInitial = useDirectoriesStore.getState();
  const sessionsInitial = useSessionsStore.getState();
  const statusInitial = useStatusStore.getState();
  const subagentInitial = useSubagentStore.getState();
  const graphInitial = useGraphStore.getState();
  let stopSubagent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useDirectoriesStore.setState(directoriesInitial, true);
    useSessionsStore.setState(sessionsInitial, true);
    useStatusStore.setState(statusInitial, true);
    useSubagentStore.setState(subagentInitial, true);
    useGraphStore.setState(graphInitial, true);

    stopSubagent = vi.fn();
    vi.spyOn(subagentEngine, "startSubagentEngine").mockReturnValue(stopSubagent);
    mockedCommands.listWorktrees.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts the subagent engine and assembles an initial forest from current state", () => {
    useDirectoriesStore.setState({ directories: [dir("/repo", "repo")] });

    const engine = startGraphEngine();

    expect(subagentEngine.startSubagentEngine).toHaveBeenCalledTimes(1);
    expect(useGraphStore.getState().roots.map((r) => r.id)).toEqual(["/repo"]);

    engine.dispose();
  });

  it("refreshes worktrees via listWorktrees for every managed repo and caches them", async () => {
    useDirectoriesStore.setState({ directories: [dir("/repo", "repo")] });
    mockedCommands.listWorktrees.mockResolvedValue([worktree("/repo", "main", true)]);

    const engine = startGraphEngine();
    await engine.refreshWorktrees();

    expect(mockedCommands.listWorktrees).toHaveBeenCalledWith("/repo");
    expect(useGraphStore.getState().worktreesByRepo["/repo"]).toHaveLength(1);
    // The repo root now has its worktree child.
    expect(useGraphStore.getState().roots[0].children.map((c) => c.id)).toEqual(["/repo"]);

    engine.dispose();
  });

  it("reassembles the forest when the sessions store changes", () => {
    useDirectoriesStore.setState({ directories: [dir("/repo", "repo")] });
    const engine = startGraphEngine();

    expect(useGraphStore.getState().roots[0].children).toEqual([]);

    useSessionsStore.setState({ sessionsByDirectory: { "/repo": [session("s1", "/repo")] } });

    expect(useGraphStore.getState().roots[0].children.map((c) => c.id)).toEqual(["s1"]);

    engine.dispose();
  });

  it("reassembles when the subagent store changes (wi-02 engine derived a subagent)", () => {
    useDirectoriesStore.setState({ directories: [dir("/repo", "repo")] });
    useSessionsStore.setState({ sessionsByDirectory: { "/repo": [session("s1", "/repo")] } });
    useStatusStore.setState({ statusBySession: { s1: statusState("ready") } });
    const engine = startGraphEngine();

    useSubagentStore.getState().set("s1", [subagent("s1:sub-0", "explorer", "working")]);

    const terminal = useGraphStore.getState().roots[0].children.find((c) => c.id === "s1")!;
    expect(terminal.children.map((c) => c.id)).toEqual(["s1:sub-0"]);
    expect(terminal.status).toBe("working");

    engine.dispose();
  });

  it("stops the subagent engine and unsubscribes on dispose", () => {
    useDirectoriesStore.setState({ directories: [dir("/repo", "repo")] });
    const engine = startGraphEngine();
    engine.dispose();

    expect(stopSubagent).toHaveBeenCalledTimes(1);

    // After dispose, a source-store change no longer reassembles the forest.
    const before = useGraphStore.getState().roots;
    useSessionsStore.setState({ sessionsByDirectory: { "/repo": [session("s1", "/repo")] } });
    expect(useGraphStore.getState().roots).toBe(before);
  });
});
