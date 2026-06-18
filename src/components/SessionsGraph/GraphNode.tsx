import type { CSSProperties } from "react";

import type { GraphNode as GraphNodeData, NodeKind } from "../../state/graphStore";
import { useGraphStore } from "../../state/graphStore";
import { usePausedStore } from "../../state/pausedStore";
import { useUiStore } from "../../state/uiStore";
import { killSession, setSessionPaused } from "../../ipc/commands";
import { pulseFor } from "../../lib/nodeStatus";
import { NodeActions } from "./NodeActions";

/**
 * One lightweight node in the sessions graph: a kind icon + label + a status
 * pulse. It is a status SUMMARY, not a live terminal — no xterm is mounted here.
 *
 * The pulse is PURELY CSS: {@link pulseFor} (wi-03) maps the rolled-up status to
 * a color token and a `pulsing` flag, which become the `graph-node--{color}`
 * and `graph-node--pulsing` classes the stylesheet animates via `@keyframes`.
 * `ready`/gray is the one non-pulsing state. Nothing animates in JS per frame.
 *
 * wi-07 makes the node a control surface. Clicking the node body NAVIGATES:
 * a terminal/subagent node selects its directory + expands its session and
 * closes the graph; an aggregate (repo/worktree) node just selects its
 * directory. A subagent resolves to its owning terminal first. Terminal nodes
 * additionally render an inline {@link NodeActions} group (pause/resume + kill
 * with confirmation); aggregate and subagent nodes offer navigate only.
 *
 * Navigation targets are resolved by walking the assembled forest from
 * `useGraphStore` (repo node id == directory path; subagent's owning terminal
 * is its parent terminal node), so the canvas only needs to forward `onActivate`.
 */
export interface GraphNodeProps {
  /** The positioned node's source data (id, kind, label, rolled-up status). */
  node: GraphNodeData;
  /** Horizontal center in layout units (the canvas applies pan/zoom around it). */
  x: number;
  /** Vertical center in layout units. */
  y: number;
  /**
   * Stable activation hook from the canvas. Fired (with the node id) on a
   * navigate so callers can observe selection; the node also performs the
   * navigate itself via the ui store.
   */
  onActivate?: (nodeId: string) => void;
}

/**
 * Where a node click should navigate, resolved from the assembled forest.
 * `dirPath` is the owning repo (a directory path); `sessionId` is the terminal
 * to expand (null for aggregate nodes, which only select the directory).
 */
interface NavigateTarget {
  dirPath: string;
  sessionId: string | null;
}

/**
 * Resolve the navigate target for `nodeId` by walking the repo-rooted forest.
 *
 *  - repo:      select its own path, no session expand.
 *  - worktree:  select its owning repo's path, no session expand.
 *  - terminal:  select its owning repo's path, expand the terminal.
 *  - subagent:  resolve to its OWNING terminal first, then as above.
 */
function resolveNavigateTarget(
  roots: GraphNodeData[],
  nodeId: string,
): NavigateTarget | null {
  for (const repo of roots) {
    if (repo.id === nodeId) return { dirPath: repo.id, sessionId: null };
    for (const child of repo.children) {
      // Worktree child of the repo: select the repo, no expand.
      if (child.kind === "worktree") {
        if (child.id === nodeId) return { dirPath: repo.id, sessionId: null };
        const hit = findTerminalIn(child.children, repo.id, nodeId);
        if (hit) return hit;
      } else {
        // Terminal attached directly to the repo root.
        const hit = findTerminalIn([child], repo.id, nodeId);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** Match a terminal node or one of its subagents within `terminals`. */
function findTerminalIn(
  terminals: GraphNodeData[],
  dirPath: string,
  nodeId: string,
): NavigateTarget | null {
  for (const terminal of terminals) {
    if (terminal.kind !== "terminal") continue;
    if (terminal.id === nodeId) return { dirPath, sessionId: terminal.id };
    // A subagent resolves to its owning terminal session.
    if (terminal.children.some((sub) => sub.id === nodeId)) {
      return { dirPath, sessionId: terminal.id };
    }
  }
  return null;
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
  const roots = useGraphStore((s) => s.roots);
  // A terminal node reflects its own paused state; only terminals can pause.
  const isPaused = usePausedStore((s) =>
    node.kind === "terminal" ? s.pausedIds.has(node.id) : false,
  );

  const className = [
    "graph-node",
    `graph-node--${node.kind}`,
    `graph-node--${pulse.color}`,
    pulse.pulsing ? "graph-node--pulsing" : null,
    isPaused ? "graph-node--paused" : null,
  ]
    .filter(Boolean)
    .join(" ");

  // Position the node by its center in layout space; the canvas's inner layer
  // applies the pan/zoom transform around these coordinates.
  const style: CSSProperties = { left: `${x}px`, top: `${y}px` };

  // Navigate: resolve the owning directory (+ terminal for terminal/subagent
  // nodes), select it in the ui store, then close the graph so the workspace
  // surfaces the chosen session.
  const navigate = () => {
    const target = resolveNavigateTarget(roots, node.id);
    if (target) {
      const ui = useUiStore.getState();
      ui.setSelectedDirectoryPath(target.dirPath);
      if (target.sessionId) ui.setExpandedSessionId(target.sessionId);
      ui.setGraphOpen(false);
    }
    // Always fire the activation hook so the canvas can observe the click even
    // when the forest has no matching target (e.g. mid-teardown).
    onActivate?.(node.id);
  };

  const isTerminal = node.kind === "terminal";

  // The node is a div with button semantics (not a <button>) so it can host the
  // nested action <button>s — interactive elements cannot nest inside a button.
  return (
    <div
      role="button"
      tabIndex={0}
      className={className}
      style={style}
      data-testid="graph-node"
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-status={node.status}
      data-pulsing={pulse.pulsing ? "true" : "false"}
      data-paused={isPaused ? "true" : "false"}
      title={node.label}
      onClick={navigate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate();
        }
      }}
    >
      <span className="graph-node-icon" aria-hidden="true">
        <KindIcon kind={node.kind} />
      </span>
      <span className="graph-node-label">{node.label}</span>
      {isPaused && (
        <span className="graph-node-paused-badge" data-testid="graph-node-paused">
          Paused
        </span>
      )}
      {isTerminal && (
        <NodeActions
          sessionId={node.id}
          isPaused={isPaused}
          onTogglePause={(sessionId, paused) => {
            void setSessionPaused(sessionId, paused);
          }}
          onKill={(sessionId) => {
            void killSession(sessionId);
          }}
        />
      )}
    </div>
  );
}

export default GraphNode;
