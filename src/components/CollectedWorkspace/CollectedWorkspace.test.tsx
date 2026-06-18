/**
 * CollectedWorkspace integration tests (RTL + Vitest).
 *
 * Exercises the assembled collected view: it consumes the live
 * `useActiveWorkspaces` hook (which fans out over the directories + sessions
 * stores) to render one <WorkspaceBay> per active directory, lays the bays out
 * as a top-row-heavy auto-grid via `computeGridLayout`, and wires each bay's
 * spawn / close to the shared sessions store with a single global focus.
 *
 * The ipc command layer is mocked: `listDirectories` / `listSessions` feed the
 * active-workspaces hook on mount, and `spawnSession` / `killSession` back the
 * spawn / close store actions. The real Terminal mounts xterm.js (unrenderable
 * under jsdom), so it is stubbed.
 */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../../ipc/commands";
import { useDirectoriesStore } from "../../state/directoriesStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useUiStore } from "../../state/uiStore";
import type { DirectoryInfo, SessionInfo } from "../../types";

vi.mock("../../ipc/commands");

// Replace the real Terminal (xterm.js) with a stub that records its sessionId.
vi.mock("../Terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-stub" data-session-id={sessionId} />
  ),
}));

import { CollectedWorkspace } from "./CollectedWorkspace";

const mocked = vi.mocked(commands);

const directory = (path: string, name: string): DirectoryInfo => ({
  path,
  name,
  isGitRepo: true,
  branch: "main",
  repo: name,
  lastModified: null,
});

const session = (id: string, dirPath: string): SessionInfo => ({ id, dirPath });

/**
 * Seed the directories + sessions stores so `useActiveWorkspaces` derives the
 * given active set without going through ipc, and stub `listDirectories` /
 * `listSessions` so the hook's reconcile effects are non-destructive no-ops.
 */
function seedWorkspaces(
  workspaces: Array<{ directory: DirectoryInfo; sessions: SessionInfo[] }>,
) {
  const directories = workspaces.map((w) => w.directory);
  const sessionsByDirectory: Record<string, SessionInfo[]> = {};
  const namesBySession: Record<string, string> = {};
  for (const w of workspaces) {
    sessionsByDirectory[w.directory.path] = w.sessions;
    for (const s of w.sessions) namesBySession[s.id] = s.id;
  }
  useDirectoriesStore.setState({ directories });
  useSessionsStore.setState({ sessionsByDirectory, namesBySession });

  mocked.listDirectories.mockResolvedValue(directories);
  mocked.listSessions.mockResolvedValue(
    workspaces.flatMap((w) => w.sessions),
  );
}

/**
 * Render the open view and flush the active-workspaces hook's mount effects
 * (loadDirectories / loadDirectory resolve asynchronously) inside act, so the
 * resulting store updates settle before assertions and never warn.
 */
async function renderOpen(onClose: () => void = () => {}) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<CollectedWorkspace open onClose={onClose} />);
    await Promise.resolve();
  });
  return result!;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDirectoriesStore.setState({ directories: [] });
  useSessionsStore.setState({ sessionsByDirectory: {}, namesBySession: {} });
  useUiStore.setState({ focusedSessionId: null, expandedSessionId: null });
  mocked.listDirectories.mockResolvedValue([]);
  mocked.listSessions.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("<CollectedWorkspace />", () => {
  it("renders nothing when closed", async () => {
    seedWorkspaces([
      { directory: directory("/a", "alpha"), sessions: [session("a1", "/a")] },
    ]);
    // The active-workspaces hook still mounts (its effects run before the
    // closed early-return), so flush its async store updates inside act.
    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <CollectedWorkspace open={false} onClose={() => {}} />,
      ));
      await Promise.resolve();
    });
    expect(container!.firstChild).toBeNull();
  });

  it("renders one bay per active workspace", async () => {
    seedWorkspaces([
      { directory: directory("/a", "alpha"), sessions: [session("a1", "/a")] },
      { directory: directory("/b", "beta"), sessions: [session("b1", "/b")] },
      { directory: directory("/c", "gamma"), sessions: [session("c1", "/c")] },
    ]);
    await renderOpen();

    const bays = screen.getAllByTestId("workspace-bay");
    expect(bays).toHaveLength(3);
    expect(bays.map((b) => b.getAttribute("data-dir-path"))).toEqual([
      "/a",
      "/b",
      "/c",
    ]);
  });

  it("lays the bays out with computeGridLayout row slicing (3 -> rows of 2 + 1)", async () => {
    seedWorkspaces([
      { directory: directory("/a", "alpha"), sessions: [session("a1", "/a")] },
      { directory: directory("/b", "beta"), sessions: [session("b1", "/b")] },
      { directory: directory("/c", "gamma"), sessions: [session("c1", "/c")] },
    ]);
    await renderOpen();

    const rows = screen.getAllByTestId("collected-grid-row");
    // computeGridLayout(3) => rows [2, 1]: top row heavy.
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByTestId("workspace-bay")).toHaveLength(2);
    expect(within(rows[1]).getAllByTestId("workspace-bay")).toHaveLength(1);
  });

  it("shows the empty-state message when no workspace has a live session", async () => {
    seedWorkspaces([]);
    await renderOpen();

    expect(screen.getByText(/no workspace has a live session/i)).toBeTruthy();
    expect(screen.queryByTestId("workspace-bay")).toBeNull();
  });

  it("spawns into a bay's own directory via addSession and focuses the new session", async () => {
    seedWorkspaces([
      { directory: directory("/a", "alpha"), sessions: [session("a1", "/a")] },
      { directory: directory("/b", "beta"), sessions: [session("b1", "/b")] },
    ]);
    mocked.spawnSession.mockResolvedValue(session("b2", "/b"));
    await renderOpen();

    const beta = screen
      .getAllByTestId("workspace-bay")
      .find((b) => b.getAttribute("data-dir-path") === "/b")!;
    await act(async () => {
      within(beta).getByRole("button", { name: "Add terminal" }).click();
    });

    expect(mocked.spawnSession).toHaveBeenCalledTimes(1);
    expect(mocked.spawnSession).toHaveBeenCalledWith("/b");
    await waitFor(() =>
      expect(useUiStore.getState().focusedSessionId).toBe("b2"),
    );
  });

  it("closes a tile via removeSession on its own directory and clears global focus", async () => {
    useUiStore.setState({ focusedSessionId: "a1", expandedSessionId: "a1" });
    seedWorkspaces([
      { directory: directory("/a", "alpha"), sessions: [session("a1", "/a")] },
    ]);
    mocked.killSession.mockResolvedValue();
    await renderOpen();

    await act(async () => {
      screen.getByRole("button", { name: "Close session a1" }).click();
    });

    expect(mocked.killSession).toHaveBeenCalledWith("a1");
    await waitFor(() =>
      expect(useUiStore.getState().focusedSessionId).toBeNull(),
    );
    expect(useUiStore.getState().expandedSessionId).toBeNull();
  });

  it("passes one global focusedSessionId to every bay", async () => {
    useUiStore.setState({ focusedSessionId: "b1" });
    seedWorkspaces([
      { directory: directory("/a", "alpha"), sessions: [session("a1", "/a")] },
      { directory: directory("/b", "beta"), sessions: [session("b1", "/b")] },
    ]);
    await renderOpen();

    // The focused tile carries data-focused="true"; only b1 is focused, across
    // all bays — proving a single global focus rather than per-bay focus.
    const tiles = screen.getAllByTestId("workspace-tile");
    const focused = tiles.filter(
      (t) => t.getAttribute("data-focused") === "true",
    );
    expect(focused).toHaveLength(1);
    expect(focused[0].getAttribute("data-session-id")).toBe("b1");
  });
});
