/**
 * Tests for the wi-07 node control surface:
 *  - NodeActions: pause/resume toggle, kill two-step confirmation, propagation.
 *  - GraphNode wiring: navigate (terminal + subagent + aggregate) selects the
 *    directory / expands the session / closes the graph, and terminal nodes
 *    render actions while aggregate/subagent nodes do not.
 *
 * IPC (`setSessionPaused`, `killSession`) is mocked so we assert calls without
 * touching the Tauri bridge; the ui store is driven through its real zustand
 * state and reset between tests.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/commands", () => ({
  setSessionPaused: vi.fn(() => Promise.resolve()),
  killSession: vi.fn(() => Promise.resolve()),
}));

import { killSession, setSessionPaused } from "../../ipc/commands";
import type { GraphNode as GraphNodeData } from "../../state/graphStore";
import { useGraphStore } from "../../state/graphStore";
import { usePausedStore } from "../../state/pausedStore";
import { useUiStore } from "../../state/uiStore";
import { GraphNode } from "./GraphNode";
import { NodeActions } from "./NodeActions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --- NodeActions (presentational) ------------------------------------------

describe("<NodeActions />", () => {
  function renderActions(
    overrides: Partial<{
      sessionId: string;
      isPaused: boolean;
      onTogglePause: (id: string, paused: boolean) => void;
      onKill: (id: string) => void;
    }> = {},
  ) {
    const props = {
      sessionId: "s1",
      isPaused: false,
      onTogglePause: vi.fn(),
      onKill: vi.fn(),
      ...overrides,
    };
    render(<NodeActions {...props} />);
    return props;
  }

  it("pauses a running session (toggles paused → true)", () => {
    const { onTogglePause } = renderActions({ isPaused: false });
    fireEvent.click(screen.getByRole("button", { name: "Pause session s1" }));
    expect(onTogglePause).toHaveBeenCalledWith("s1", true);
  });

  it("resumes a paused session (toggles paused → false)", () => {
    const { onTogglePause } = renderActions({ isPaused: true });
    fireEvent.click(screen.getByRole("button", { name: "Resume session s1" }));
    expect(onTogglePause).toHaveBeenCalledWith("s1", false);
  });

  it("does NOT kill on the first click — it arms a confirmation first", () => {
    const { onKill } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Kill session s1" }));
    expect(onKill).not.toHaveBeenCalled();
    // The confirm + cancel controls are now present.
    expect(
      screen.getByRole("button", { name: "Confirm kill session s1" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cancel kill session s1" }),
    ).toBeTruthy();
  });

  it("kills only after the confirmation is clicked", () => {
    const { onKill } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Kill session s1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm kill session s1" }));
    expect(onKill).toHaveBeenCalledWith("s1");
  });

  it("cancelling the confirmation does not kill and restores the kill button", () => {
    const { onKill } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Kill session s1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel kill session s1" }));
    expect(onKill).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Kill session s1" })).toBeTruthy();
  });

  it("stops click propagation so navigate/pan do not fire", () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <NodeActions
          sessionId="s1"
          isPaused={false}
          onTogglePause={vi.fn()}
          onKill={vi.fn()}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause session s1" }));
    fireEvent.click(screen.getByRole("button", { name: "Kill session s1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm kill session s1" }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});

// --- GraphNode wiring (navigate + actions) ---------------------------------

function repo(id: string, children: GraphNodeData[]): GraphNodeData {
  return { id, kind: "repo", label: id, status: "ready", children };
}
function worktree(id: string, children: GraphNodeData[]): GraphNodeData {
  return { id, kind: "worktree", label: id, status: "ready", children };
}
function terminal(id: string, children: GraphNodeData[] = []): GraphNodeData {
  return { id, kind: "terminal", label: id, status: "ready", children };
}
function subagent(id: string): GraphNodeData {
  return { id, kind: "subagent", label: id, status: "working", children: [] };
}

describe("GraphNode control surface", () => {
  beforeEach(() => {
    useUiStore.setState({
      selectedDirectoryPath: null,
      expandedSessionId: null,
      graphOpen: true,
    });
    usePausedStore.setState({ pausedIds: new Set<string>() });
  });

  function setForest(roots: GraphNodeData[]) {
    useGraphStore.setState({ roots });
  }

  it("terminal node: clicking navigates to its repo + expands the session + closes the graph", () => {
    setForest([repo("/repo", [terminal("term-1")])]);
    render(<GraphNode node={terminal("term-1")} x={0} y={0} />);
    fireEvent.click(screen.getByTestId("graph-node"));
    const ui = useUiStore.getState();
    expect(ui.selectedDirectoryPath).toBe("/repo");
    expect(ui.expandedSessionId).toBe("term-1");
    expect(ui.graphOpen).toBe(false);
  });

  it("terminal under a worktree: navigate selects the OWNING repo path", () => {
    setForest([
      repo("/repo", [worktree("/repo/wt", [terminal("term-2")])]),
    ]);
    render(<GraphNode node={terminal("term-2")} x={0} y={0} />);
    fireEvent.click(screen.getByTestId("graph-node"));
    const ui = useUiStore.getState();
    expect(ui.selectedDirectoryPath).toBe("/repo");
    expect(ui.expandedSessionId).toBe("term-2");
  });

  it("subagent node: navigate resolves to the OWNING terminal session", () => {
    setForest([
      repo("/repo", [terminal("term-3", [subagent("sub-a")])]),
    ]);
    render(<GraphNode node={subagent("sub-a")} x={0} y={0} />);
    fireEvent.click(screen.getByTestId("graph-node"));
    const ui = useUiStore.getState();
    expect(ui.selectedDirectoryPath).toBe("/repo");
    // Expands the owning terminal, not the subagent id.
    expect(ui.expandedSessionId).toBe("term-3");
  });

  it("aggregate (repo) node: navigate selects its directory but expands nothing", () => {
    setForest([repo("/repo", [terminal("term-4")])]);
    render(<GraphNode node={repo("/repo", [])} x={0} y={0} />);
    fireEvent.click(screen.getByTestId("graph-node"));
    const ui = useUiStore.getState();
    expect(ui.selectedDirectoryPath).toBe("/repo");
    expect(ui.expandedSessionId).toBeNull();
    expect(ui.graphOpen).toBe(false);
  });

  it("renders pause/resume + kill only on terminal nodes", () => {
    setForest([repo("/repo", [terminal("term-5")])]);
    render(<GraphNode node={terminal("term-5")} x={0} y={0} />);
    expect(screen.getByTestId("node-actions")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Pause session term-5" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Kill session term-5" }),
    ).toBeTruthy();
  });

  it("does NOT render actions on aggregate (repo/worktree) or subagent nodes", () => {
    setForest([repo("/repo", [worktree("/repo/wt", []), terminal("term-6")])]);
    render(<GraphNode node={repo("/repo", [])} x={0} y={0} />);
    expect(screen.queryByTestId("node-actions")).toBeNull();
    cleanup();
    render(<GraphNode node={worktree("/repo/wt", [])} x={0} y={0} />);
    expect(screen.queryByTestId("node-actions")).toBeNull();
    cleanup();
    render(<GraphNode node={subagent("sub-x")} x={0} y={0} />);
    expect(screen.queryByTestId("node-actions")).toBeNull();
  });

  it("pause action on a terminal node calls setSessionPaused via IPC", () => {
    setForest([repo("/repo", [terminal("term-7")])]);
    render(<GraphNode node={terminal("term-7")} x={0} y={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause session term-7" }));
    expect(setSessionPaused).toHaveBeenCalledWith("term-7", true);
  });

  it("kill on a terminal node confirms first, then calls killSession via IPC", () => {
    setForest([repo("/repo", [terminal("term-8")])]);
    render(<GraphNode node={terminal("term-8")} x={0} y={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Kill session term-8" }));
    expect(killSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm kill session term-8" }));
    expect(killSession).toHaveBeenCalledWith("term-8");
  });

  it("a paused terminal node is visibly marked and offers resume", () => {
    setForest([repo("/repo", [terminal("term-9")])]);
    usePausedStore.setState({ pausedIds: new Set(["term-9"]) });
    render(<GraphNode node={terminal("term-9")} x={0} y={0} />);
    const node = screen.getByTestId("graph-node");
    expect(node).toHaveClass("graph-node--paused");
    expect(node).toHaveAttribute("data-paused", "true");
    expect(screen.getByTestId("graph-node-paused")).toBeTruthy();
    // Resume (not pause) is offered while paused.
    expect(
      screen.getByRole("button", { name: "Resume session term-9" }),
    ).toBeTruthy();
  });

  it("clicking a node action does not trigger navigate", () => {
    setForest([repo("/repo", [terminal("term-10")])]);
    render(<GraphNode node={terminal("term-10")} x={0} y={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause session term-10" }));
    // Navigate would have flipped graphOpen to false / set selection.
    const ui = useUiStore.getState();
    expect(ui.graphOpen).toBe(true);
    expect(ui.selectedDirectoryPath).toBeNull();
  });
});
