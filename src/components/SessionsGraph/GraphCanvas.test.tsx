/**
 * GraphCanvas render tests (RTL + Vitest).
 *
 * Covers: rendering one node per tree node with SVG connectors, reflecting live
 * graphStore updates with no manual refresh, and the empty state. Layout math
 * itself is covered by graphLayout.test.ts; here we assert the canvas renders
 * the layout result and stays subscribed to the store.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GraphNode } from "../../state/graphStore";
import { useGraphStore } from "../../state/graphStore";
import { GraphCanvas } from "./GraphCanvas";

function node(
  id: string,
  kind: GraphNode["kind"],
  children: GraphNode[] = [],
): GraphNode {
  return { id, kind, label: id, status: "ready", children };
}

/** Replace the store's assembled forest (the canvas reads it via useGraph). */
function setRoots(roots: GraphNode[]) {
  act(() => useGraphStore.setState({ roots }));
}

beforeEach(() => {
  useGraphStore.setState({ roots: [], worktreesByRepo: {} });
});

afterEach(cleanup);

describe("GraphCanvas", () => {
  it("renders the empty state when there are no nodes", () => {
    render(<GraphCanvas />);
    expect(screen.getByTestId("graph-canvas-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId("graph-node")).toHaveLength(0);
  });

  it("renders one node per tree node with connectors between parent and children", () => {
    setRoots([
      node("repo", "repo", [
        node("wt", "worktree", [
          node("term", "terminal", [node("sub", "subagent")]),
        ]),
      ]),
    ]);

    render(<GraphCanvas />);

    expect(screen.getAllByTestId("graph-node")).toHaveLength(4);
    expect(screen.queryByTestId("graph-canvas-empty")).not.toBeInTheDocument();

    // One SVG edge path per parent→child link (3 links here).
    const edges = screen
      .getByTestId("graph-canvas-layer")
      .querySelectorAll(".graph-edge");
    expect(edges).toHaveLength(3);
  });

  it("reflects live store updates with no manual refresh", () => {
    setRoots([node("repo", "repo")]);
    render(<GraphCanvas />);
    expect(screen.getAllByTestId("graph-node")).toHaveLength(1);

    // A session appears under the repo: the canvas re-renders from the store.
    setRoots([node("repo", "repo", [node("term", "terminal")])]);
    expect(screen.getAllByTestId("graph-node")).toHaveLength(2);

    // The session vanishes: the canvas drops it.
    setRoots([node("repo", "repo")]);
    expect(screen.getAllByTestId("graph-node")).toHaveLength(1);
  });

  it("applies a pan/zoom transform on the inner layer", () => {
    setRoots([node("repo", "repo")]);
    render(<GraphCanvas />);
    const layer = screen.getByTestId("graph-canvas-layer");
    // Initial transform: identity translate + scale 1.
    expect(layer.style.transform).toContain("scale(1)");
    expect(layer.style.transform).toContain("translate(0px, 0px)");
  });

  it("exposes each node's stable handle for wi-07", () => {
    setRoots([node("repo", "repo", [node("term", "terminal")])]);
    render(<GraphCanvas />);
    const ids = screen
      .getAllByTestId("graph-node")
      .map((n) => n.getAttribute("data-node-id"));
    expect(ids).toEqual(expect.arrayContaining(["repo", "term"]));
  });
});
