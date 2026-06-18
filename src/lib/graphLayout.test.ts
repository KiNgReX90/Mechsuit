import { describe, expect, it } from "vitest";

import type { GraphNode } from "../state/graphStore";
import {
  COLUMN_GAP,
  LAYOUT_PADDING,
  TIER_GAP,
  computeGraphLayout,
} from "./graphLayout";

/** Terse node builder for layout fixtures (status is irrelevant to layout). */
function node(
  id: string,
  kind: GraphNode["kind"],
  children: GraphNode[] = [],
): GraphNode {
  return { id, kind, label: id, status: "ready", children };
}

describe("computeGraphLayout", () => {
  it("returns an empty layout with zero size for an empty forest", () => {
    expect(computeGraphLayout([])).toEqual({
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
    });
  });

  it("places a single node at the padding origin in tier 0", () => {
    const { nodes, edges } = computeGraphLayout([node("repo", "repo")]);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
    expect(nodes[0]).toMatchObject({
      tier: 0,
      x: LAYOUT_PADDING,
      y: LAYOUT_PADDING,
    });
  });

  it("assigns tier by depth and one edge per parent→child link", () => {
    const tree = node("repo", "repo", [
      node("wt", "worktree", [
        node("term", "terminal", [node("sub", "subagent")]),
      ]),
    ]);
    const { nodes, edges } = computeGraphLayout([tree]);

    const tierById = Object.fromEntries(nodes.map((n) => [n.node.id, n.tier]));
    expect(tierById).toEqual({ repo: 0, wt: 1, term: 2, sub: 3 });

    // y grows by TIER_GAP per tier.
    const yById = Object.fromEntries(nodes.map((n) => [n.node.id, n.y]));
    expect(yById.sub - yById.term).toBe(TIER_GAP);
    expect(yById.term - yById.wt).toBe(TIER_GAP);

    // Edges are emitted in post-order (a parent's edge to a child is pushed
    // after that child's subtree), so assert the set rather than the order.
    expect(edges).toHaveLength(3);
    expect(edges).toEqual(
      expect.arrayContaining([
        { fromId: "repo", toId: "wt" },
        { fromId: "wt", toId: "term" },
        { fromId: "term", toId: "sub" },
      ]),
    );
  });

  it("packs sibling leaves into distinct adjacent columns", () => {
    const tree = node("repo", "repo", [
      node("a", "terminal"),
      node("b", "terminal"),
      node("c", "terminal"),
    ]);
    const { nodes } = computeGraphLayout([tree]);
    const xById = Object.fromEntries(nodes.map((n) => [n.node.id, n.x]));

    expect(xById.b - xById.a).toBe(COLUMN_GAP);
    expect(xById.c - xById.b).toBe(COLUMN_GAP);
    // No two leaves overlap.
    expect(new Set([xById.a, xById.b, xById.c]).size).toBe(3);
  });

  it("centers a parent over the horizontal span of its children", () => {
    const tree = node("repo", "repo", [
      node("a", "terminal"),
      node("b", "terminal"),
    ]);
    const { nodes } = computeGraphLayout([tree]);
    const xById = Object.fromEntries(nodes.map((n) => [n.node.id, n.x]));

    expect(xById.repo).toBe((xById.a + xById.b) / 2);
  });

  it("lays out multiple roots side by side without column overlap", () => {
    const forest = [
      node("repo1", "repo", [node("a", "terminal"), node("b", "terminal")]),
      node("repo2", "repo", [node("c", "terminal")]),
    ];
    const { nodes } = computeGraphLayout(forest);
    const xById = Object.fromEntries(nodes.map((n) => [n.node.id, n.x]));

    // repo2's leaf sits to the right of repo1's leaves — subtrees never share a
    // column.
    expect(xById.c).toBeGreaterThan(xById.b);
    expect(new Set([xById.a, xById.b, xById.c]).size).toBe(3);
  });

  it("reports a height covering the deepest tier and a width covering the widest node", () => {
    const tree = node("repo", "repo", [
      node("wt", "worktree", [node("term", "terminal")]),
    ]);
    const { width, height, nodes } = computeGraphLayout([tree]);

    const maxX = Math.max(...nodes.map((n) => n.x));
    expect(width).toBe(maxX + LAYOUT_PADDING);
    // 3 tiers (0,1,2) → 2 gaps of TIER_GAP plus padding top and bottom.
    expect(height).toBe(LAYOUT_PADDING + 2 * TIER_GAP + LAYOUT_PADDING);
  });
});
