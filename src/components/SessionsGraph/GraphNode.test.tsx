/**
 * GraphNode render tests (RTL + Vitest).
 *
 * Covers: icon + label render per kind, and the wi-03 status → pulse-class
 * mapping (the load-bearing AC — `ready`/gray must NOT pulse; green/orange/red
 * do). The pulse itself is CSS, so we assert the classes/attributes the
 * stylesheet keys off rather than animation behavior.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GraphNode as GraphNodeData, NodeKind } from "../../state/graphStore";
import type { SessionStatus } from "../../types";
import { GraphNode } from "./GraphNode";

afterEach(cleanup);

function makeNode(overrides: Partial<GraphNodeData> = {}): GraphNodeData {
  return {
    id: "n1",
    kind: "terminal",
    label: "session-1",
    status: "ready",
    children: [],
    ...overrides,
  };
}

describe("GraphNode", () => {
  it("renders the label and an icon", () => {
    render(<GraphNode node={makeNode({ label: "my-repo" })} x={10} y={20} />);
    expect(screen.getByText("my-repo")).toBeInTheDocument();
    // The kind icon is an inline SVG inside the node.
    expect(screen.getByTestId("graph-node").querySelector("svg")).toBeTruthy();
  });

  it("positions the node at its (x, y) in layout space", () => {
    render(<GraphNode node={makeNode()} x={42} y={84} />);
    const node = screen.getByTestId("graph-node");
    expect(node.style.left).toBe("42px");
    expect(node.style.top).toBe("84px");
  });

  it("exposes a stable handle for wi-07 (id + kind data attributes)", () => {
    render(<GraphNode node={makeNode({ id: "abc", kind: "worktree" })} x={0} y={0} />);
    const node = screen.getByTestId("graph-node");
    expect(node).toHaveAttribute("data-node-id", "abc");
    expect(node).toHaveAttribute("data-node-kind", "worktree");
  });

  it("calls onActivate with the node id when clicked", () => {
    const onActivate = vi.fn();
    render(<GraphNode node={makeNode({ id: "xyz" })} x={0} y={0} onActivate={onActivate} />);
    fireEvent.click(screen.getByTestId("graph-node"));
    expect(onActivate).toHaveBeenCalledWith("xyz");
  });

  describe("status → pulse class mapping (wi-03)", () => {
    const cases: Array<{
      status: SessionStatus;
      color: string;
      pulsing: boolean;
    }> = [
      { status: "working", color: "green", pulsing: true },
      { status: "awaiting-approval", color: "orange", pulsing: true },
      { status: "ready", color: "gray", pulsing: false },
      { status: "error", color: "red", pulsing: true },
    ];

    for (const { status, color, pulsing } of cases) {
      it(`${status} → ${color}, ${pulsing ? "pulsing" : "static"}`, () => {
        render(<GraphNode node={makeNode({ status })} x={0} y={0} />);
        const node = screen.getByTestId("graph-node");
        expect(node).toHaveClass(`graph-node--${color}`);
        if (pulsing) {
          expect(node).toHaveClass("graph-node--pulsing");
          expect(node).toHaveAttribute("data-pulsing", "true");
        } else {
          expect(node).not.toHaveClass("graph-node--pulsing");
          expect(node).toHaveAttribute("data-pulsing", "false");
        }
      });
    }

    it("ready (gray) is the only non-pulsing state", () => {
      render(<GraphNode node={makeNode({ status: "ready" })} x={0} y={0} />);
      expect(screen.getByTestId("graph-node")).not.toHaveClass("graph-node--pulsing");
    });
  });

  describe("kind icons", () => {
    const kinds: NodeKind[] = ["repo", "worktree", "terminal", "subagent"];
    for (const kind of kinds) {
      it(`renders a kind class + icon for ${kind}`, () => {
        render(<GraphNode node={makeNode({ kind })} x={0} y={0} />);
        const node = screen.getByTestId("graph-node");
        expect(node).toHaveClass(`graph-node--${kind}`);
        expect(node.querySelector(".graph-node-icon svg")).toBeTruthy();
      });
    }
  });
});
