/**
 * Pure tiered tree layout for the sessions graph.
 *
 * Turns the wi-04 `GraphNode[]` forest (repo → worktree → terminal → subagent)
 * into positioned nodes plus edges the canvas renders. Mirrors `gridLayout`:
 * a pure, dependency-free function (no React, no DOM, no side effects) so the
 * layout math is unit-testable on representative trees. Pan/zoom is a CSS
 * transform applied over this result — it never re-runs layout.
 *
 * Algorithm: a deterministic top-down tiered layout. Every node's depth is its
 * tier (column-independent vertical band). Leaves are packed left-to-right in
 * encounter order; a parent is centered over the horizontal span of its
 * children (falling back to the next free column when it has none). This keeps
 * subtrees from overlapping while staying O(n) and easy to reason about.
 */
import type { GraphNode } from "../state/graphStore";

/** A single node placed in graph space (pre-transform, in layout units). */
export interface PositionedNode {
  /** The source tree node (carries id/kind/label/status for rendering). */
  node: GraphNode;
  /** Horizontal center of the node, in layout units. */
  x: number;
  /** Vertical center of the node, in layout units. */
  y: number;
  /** Depth in the forest (0 = repo roots), used for tier styling/bands. */
  tier: number;
}

/** A connector between a parent node and one of its children, by id. */
export interface GraphEdge {
  /** Parent node id. */
  fromId: string;
  /** Child node id. */
  toId: string;
}

/** The pure layout result the canvas renders. */
export interface GraphLayout {
  /** Every node in the forest, positioned, in pre-order. */
  nodes: PositionedNode[];
  /** Every parent→child connector. */
  edges: GraphEdge[];
  /** Total layout width (max node x + half a node), in layout units. */
  width: number;
  /** Total layout height (deepest tier band bottom), in layout units. */
  height: number;
}

/** Horizontal distance between adjacent leaf columns, in layout units. */
export const COLUMN_GAP = 200;
/** Vertical distance between tier bands, in layout units. */
export const TIER_GAP = 140;
/** Padding around the whole layout so nodes are not flush to the edge. */
export const LAYOUT_PADDING = 80;

/**
 * Compute the tiered layout for a `GraphNode[]` forest.
 *
 * Pure: identical input forests produce identical layouts. An empty forest
 * yields an empty layout with zero size. The forest is laid out as if under a
 * single virtual root, so multiple repos pack side by side without overlap.
 */
export function computeGraphLayout(roots: GraphNode[]): GraphLayout {
  const nodes: PositionedNode[] = [];
  const edges: GraphEdge[] = [];

  // Next free leaf column. Advanced once per leaf in encounter order so no two
  // leaves share a column; parents are then centered over their children.
  let nextColumn = 0;
  let maxTier = 0;

  /**
   * Place one node and its subtree, returning the node's column center. Leaves
   * consume the next free column; parents recurse first, then center over the
   * span of their children's centers.
   */
  const place = (node: GraphNode, tier: number): number => {
    if (tier > maxTier) maxTier = tier;

    let column: number;
    if (node.children.length === 0) {
      column = nextColumn;
      nextColumn += 1;
    } else {
      const childColumns = node.children.map((child) => {
        const childColumn = place(child, tier + 1);
        edges.push({ fromId: node.id, toId: child.id });
        return childColumn;
      });
      // Center the parent over the horizontal span of its children.
      column = (childColumns[0] + childColumns[childColumns.length - 1]) / 2;
    }

    nodes.push({
      node,
      x: LAYOUT_PADDING + column * COLUMN_GAP,
      y: LAYOUT_PADDING + tier * TIER_GAP,
      tier,
    });
    return column;
  };

  for (const root of roots) {
    place(root, 0);
  }

  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const maxX = Math.max(...nodes.map((n) => n.x));
  const width = maxX + LAYOUT_PADDING;
  const height = LAYOUT_PADDING + maxTier * TIER_GAP + LAYOUT_PADDING;

  return { nodes, edges, width, height };
}
