import type { CSSProperties } from "react";

import type { GraphNode as GraphNodeData, NodeKind } from "../../state/graphStore";
import { pulseFor } from "../../lib/nodeStatus";

/**
 * One lightweight node in the sessions graph: a kind icon + label + a status
 * pulse. It is a status SUMMARY, not a live terminal — no xterm is mounted here.
 *
 * The pulse is PURELY CSS: {@link pulseFor} (wi-03) maps the rolled-up status to
 * a color token and a `pulsing` flag, which become the `graph-node--{color}`
 * and `graph-node--pulsing` classes the stylesheet animates via `@keyframes`.
 * `ready`/gray is the one non-pulsing state. Nothing animates in JS per frame.
 *
 * wi-07 attaches click/pause/kill here: it passes `onActivate` (wired to the
 * root button) and may use `data-node-id` / `data-node-kind` as a stable handle.
 * This item implements NO interactions beyond exposing those hooks.
 */
export interface GraphNodeProps {
  /** The positioned node's source data (id, kind, label, rolled-up status). */
  node: GraphNodeData;
  /** Horizontal center in layout units (the canvas applies pan/zoom around it). */
  x: number;
  /** Vertical center in layout units. */
  y: number;
  /**
   * Stable activation hook for wi-07. Optional and unused by this item beyond
   * wiring it to the node button so later work can attach actions.
   */
  onActivate?: (nodeId: string) => void;
}

/** Inline SVG glyph per node kind (matches the TitleBar inline-SVG convention). */
function KindIcon({ kind }: { kind: NodeKind }) {
  switch (kind) {
    case "repo":
      // A stacked-cubes "repository" mark.
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 3 3 7.5 12 12l9-4.5L12 3Z"
            fill="currentColor"
            opacity="0.9"
          />
          <path
            d="M3 12.5 12 17l9-4.5M3 17 12 21.5 21 17"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "worktree":
      // A git-branch mark (worktree = a branch checkout).
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="6" cy="6" r="2.4" fill="currentColor" />
          <circle cx="6" cy="18" r="2.4" fill="currentColor" />
          <circle cx="18" cy="9" r="2.4" fill="currentColor" />
          <path
            d="M6 8.4v7.2M6 15.6c0-4 0-6 6-6.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "terminal":
      // A terminal window with a prompt caret.
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect
            x="3"
            y="4"
            width="18"
            height="16"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="m7 9 3 3-3 3M12.5 15h4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "subagent":
      // A spark/star mark for a delegated subagent.
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5L3.5 11 10 9l2-6.5Z"
            fill="currentColor"
          />
        </svg>
      );
  }
}

export function GraphNode({ node, x, y, onActivate }: GraphNodeProps) {
  const pulse = pulseFor(node.status);
  const className = [
    "graph-node",
    `graph-node--${node.kind}`,
    `graph-node--${pulse.color}`,
    pulse.pulsing ? "graph-node--pulsing" : null,
  ]
    .filter(Boolean)
    .join(" ");

  // Position the node by its center in layout space; the canvas's inner layer
  // applies the pan/zoom transform around these coordinates.
  const style: CSSProperties = { left: `${x}px`, top: `${y}px` };

  return (
    <button
      type="button"
      className={className}
      style={style}
      data-testid="graph-node"
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-status={node.status}
      data-pulsing={pulse.pulsing ? "true" : "false"}
      title={node.label}
      // wi-07 wires real actions here; until then activation is a no-op hook.
      onClick={() => onActivate?.(node.id)}
    >
      <span className="graph-node-icon" aria-hidden="true">
        <KindIcon kind={node.kind} />
      </span>
      <span className="graph-node-label">{node.label}</span>
    </button>
  );
}

export default GraphNode;
