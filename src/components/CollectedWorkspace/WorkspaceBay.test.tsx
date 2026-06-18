/**
 * WorkspaceBay tests (RTL + Vitest).
 *
 * The bay is purely presentational and wired by props. The shared <Grid> mounts
 * a Terminal per tile; the real Terminal mounts xterm.js (unrenderable under
 * jsdom), so it is stubbed. The ipc command layer is mocked because Grid's
 * paused-tile Resume button and SessionActions touch it indirectly.
 *
 * Covers: header renders name + branch + the 2/4/6/8 quick-spawn controls and
 * an add-terminal button; spawn controls fire onSpawnTerminals with the right
 * "spawns to reach" count; per-tile close routes to onCloseSession; the body
 * tiles sessions through the shared Grid with the expand control suppressed.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionsStore } from "../../state/sessionsStore";
import { useStatusStore } from "../../state/statusStore";
import { usePausedStore } from "../../state/pausedStore";
import type { DirectoryInfo, SessionInfo } from "../../types";

vi.mock("../../ipc/commands");

// Replace the real Terminal (xterm.js) with a stub that records its sessionId.
vi.mock("../Terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-stub" data-session-id={sessionId} />
  ),
}));

import { WorkspaceBay } from "./WorkspaceBay";

const DIR_PATH = "/home/ruben/repo";

const directory = (overrides: Partial<DirectoryInfo> = {}): DirectoryInfo => ({
  path: DIR_PATH,
  name: "repo",
  isGitRepo: true,
  branch: "main",
  repo: "repo",
  lastModified: null,
  ...overrides,
});

const session = (id: string): SessionInfo => ({ id, dirPath: DIR_PATH });

function renderBay(overrides: Partial<{
  directory: DirectoryInfo;
  sessions: SessionInfo[];
  focusedSessionId: string | null;
  onSpawnTerminals: (count: number) => void;
  onCloseSession: (id: string) => void;
}> = {}) {
  const props = {
    directory: directory(),
    sessions: [session("s1"), session("s2")],
    focusedSessionId: null,
    onSpawnTerminals: vi.fn(),
    onCloseSession: vi.fn(),
    ...overrides,
  };
  // Grid renders tile names from the sessions store; seed them so tiles show.
  useSessionsStore.setState({
    namesBySession: Object.fromEntries(
      props.sessions.map((s) => [s.id, s.id]),
    ),
  });
  render(<WorkspaceBay {...props} />);
  return props;
}

beforeEach(() => {
  useSessionsStore.setState({ sessionsByDirectory: {}, namesBySession: {} });
  useStatusStore.setState({ statusBySession: {} });
  usePausedStore.setState({ pausedIds: new Set() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("<WorkspaceBay />", () => {
  it("renders the directory display name and git branch", () => {
    renderBay({ directory: directory({ name: "my-repo", branch: "feature/x" }) });
    expect(screen.getByText("my-repo")).toBeTruthy();
    expect(screen.getByText("feature/x")).toBeTruthy();
  });

  it("omits the branch element for a non-git directory", () => {
    renderBay({ directory: directory({ branch: null }) });
    expect(screen.queryByText("main")).toBeNull();
  });

  it("renders only the quick-spawn targets still reachable from the session count", () => {
    // Two sessions open: only 4/6/8 remain reachable (not 2).
    renderBay({ sessions: [session("s1"), session("s2")] });
    expect(screen.queryByRole("button", { name: "Open 2 terminals" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open 4 terminals" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open 6 terminals" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open 8 terminals" })).toBeTruthy();
  });

  it("calls onSpawnTerminals with the spawns-to-reach count for a quick option", () => {
    // One session open; "Open 4 terminals" must spawn 3 to reach 4.
    const { onSpawnTerminals } = renderBay({ sessions: [session("s1")] });
    screen.getByRole("button", { name: "Open 4 terminals" }).click();
    expect(onSpawnTerminals).toHaveBeenCalledWith(3);
  });

  it("calls onSpawnTerminals(1) for the add-terminal button", () => {
    const { onSpawnTerminals } = renderBay();
    screen.getByRole("button", { name: "Add terminal" }).click();
    expect(onSpawnTerminals).toHaveBeenCalledWith(1);
  });

  it("tiles its sessions through the shared Grid", () => {
    renderBay({ sessions: [session("s1"), session("s2")] });
    const grid = screen.getByTestId("workspace-grid");
    expect(grid).toBeTruthy();
    expect(within(grid).getAllByTestId("workspace-tile")).toHaveLength(2);
    expect(within(grid).getAllByTestId("terminal-stub")).toHaveLength(2);
  });

  it("suppresses the per-tile expand control in the grid", () => {
    renderBay({ sessions: [session("s1")] });
    expect(
      screen.queryByRole("button", { name: "Expand session s1" }),
    ).toBeNull();
  });

  it("routes a per-tile close to onCloseSession with the session id", () => {
    const { onCloseSession } = renderBay({ sessions: [session("s1")] });
    screen.getByRole("button", { name: "Close session s1" }).click();
    expect(onCloseSession).toHaveBeenCalledWith("s1");
  });
});
