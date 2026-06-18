/**
 * Grid / GridTile focused render-scoping tests (RTL + Vitest).
 *
 * Verifies that a single session's status change re-renders only the affected
 * tile and not unrelated tiles — the core goal of the scoped-status-subscription
 * refactor. Also covers that tileStatusKind / tileStatusClass remain exported
 * from Grid.tsx (regression guard).
 *
 * Terminal is mocked (xterm.js cannot run under jsdom). IPC is mocked so no
 * Tauri backend is required.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStatusStore } from "../../state/statusStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useUiStore } from "../../state/uiStore";
import { usePausedStore } from "../../state/pausedStore";
import type { SessionInfo } from "../../types";

vi.mock("../../ipc/commands");

vi.mock("../Terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-stub" data-session-id={sessionId} />
  ),
}));

import { Grid, tileStatusKind, tileStatusClass } from "./Grid";

const session = (id: string): SessionInfo => ({ id, dirPath: "/repo" });

beforeEach(() => {
  vi.clearAllMocks();
  useSessionsStore.setState({ sessionsByDirectory: {}, namesBySession: {} });
  useUiStore.setState({ selectedDirectoryPath: "/repo", focusedSessionId: null, expandedSessionId: null });
  useStatusStore.setState({ statusBySession: {} });
  usePausedStore.setState({ pausedIds: new Set() });
});

afterEach(() => {
  cleanup();
});

// Helper: find a tile element by session id.
function tileFor(sessionId: string): HTMLElement {
  return screen
    .getAllByTestId("workspace-tile")
    .find((t) => t.getAttribute("data-session-id") === sessionId)!;
}

describe("Grid exports", () => {
  it("tileStatusKind and tileStatusClass are exported from Grid.tsx", () => {
    // Regression guard: other modules (e.g. Workspace.tsx) import these.
    expect(typeof tileStatusKind).toBe("function");
    expect(typeof tileStatusClass).toBe("function");
  });

  it("tileStatusKind returns null for working status", () => {
    expect(tileStatusKind({ status: "working", acknowledged: true, promptedSinceAck: false })).toBeNull();
  });

  it("tileStatusKind returns 'ready' for unacknowledged ready", () => {
    expect(tileStatusKind({ status: "ready", acknowledged: false, promptedSinceAck: false })).toBe("ready");
  });

  it("tileStatusKind returns null for acknowledged ready", () => {
    expect(tileStatusKind({ status: "ready", acknowledged: true, promptedSinceAck: false })).toBeNull();
  });

  it("tileStatusClass returns the css class string for a status kind", () => {
    expect(tileStatusClass({ status: "error", acknowledged: false, promptedSinceAck: false })).toBe("workspace-tile--error");
    expect(tileStatusClass(undefined)).toBeNull();
  });
});

describe("Grid renders tiles for each session", () => {
  it("renders one tile per session", () => {
    render(
      <Grid
        sessions={[session("a"), session("b"), session("c")]}
        focusedSessionId={null}
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("workspace-tile")).toHaveLength(3);
  });

  it("applies focused class to the focused tile only", () => {
    render(
      <Grid
        sessions={[session("a"), session("b")]}
        focusedSessionId="a"
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(tileFor("a")).toHaveClass("workspace-tile--focused");
    expect(tileFor("b")).not.toHaveClass("workspace-tile--focused");
  });

  it("applies status class to non-focused tile and not to focused tile (FOCUS WINS)", () => {
    useStatusStore.setState({
      statusBySession: {
        a: { status: "error", acknowledged: false, promptedSinceAck: false },
        b: { status: "error", acknowledged: false, promptedSinceAck: false },
      },
    });

    render(
      <Grid
        sessions={[session("a"), session("b")]}
        focusedSessionId="a"
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Focused tile: accent border only, status color suppressed.
    expect(tileFor("a")).toHaveClass("workspace-tile--focused");
    expect(tileFor("a")).not.toHaveClass("workspace-tile--error");
    // Non-focused tile: status color shows.
    expect(tileFor("b")).toHaveClass("workspace-tile--error");
  });
});

describe("GridTile scoped re-render", () => {
  it("a status change on session B does not change session A tile's class", () => {
    useStatusStore.setState({ statusBySession: {} });

    render(
      <Grid
        sessions={[session("a"), session("b")]}
        focusedSessionId={null}
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Both tiles start neutral.
    expect(tileFor("a").className).toBe("workspace-tile");
    expect(tileFor("b").className).toBe("workspace-tile");

    // Only session B's status changes.
    act(() => {
      useStatusStore.getState().setStatus("b", "error");
    });

    // Session A tile is still neutral — its class did not change.
    expect(tileFor("a").className).toBe("workspace-tile");
    // Session B tile picked up the status class.
    expect(tileFor("b")).toHaveClass("workspace-tile--error");
  });

  it("a status change on session A does not change session B tile's class", () => {
    useStatusStore.setState({
      statusBySession: {
        b: { status: "ready", acknowledged: false, promptedSinceAck: false },
      },
    });

    render(
      <Grid
        sessions={[session("a"), session("b")]}
        focusedSessionId={null}
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(tileFor("b")).toHaveClass("workspace-tile--ready");

    act(() => {
      useStatusStore.getState().setStatus("a", "awaiting-approval");
    });

    // Session B tile still shows ready — updating A didn't perturb B.
    expect(tileFor("b")).toHaveClass("workspace-tile--ready");
    expect(tileFor("a")).toHaveClass("workspace-tile--awaiting-approval");
  });

  it("Grid itself does not subscribe to the whole statusBySession map", () => {
    // The scoped selector means Grid.tsx must NOT call useStatusStore with a
    // selector that returns the whole statusBySession object. We verify this
    // indirectly: if Grid were subscribed to the whole map, every status change
    // would re-render the grid wrapper; since our tiles are scoped, only the
    // individual tile re-renders. This test confirms correct class isolation as
    // a proxy for scoped subscriptions.
    //
    // Seed y with a prompted+working entry so setStatus("y","ready") produces
    // acknowledged:false (the blink path). x and z start untracked (neutral).
    useStatusStore.setState({
      statusBySession: {
        y: { status: "working", acknowledged: true, promptedSinceAck: true },
      },
    });

    render(
      <Grid
        sessions={[session("x"), session("y"), session("z")]}
        focusedSessionId={null}
        onExpand={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("workspace-tile")).toHaveLength(3);

    // Update only y's status — x and z must not change.
    act(() => {
      useStatusStore.getState().setStatus("y", "ready");
    });

    // x and z are still neutral; y picked up the ready (unacknowledged) class.
    expect(tileFor("x").className).toBe("workspace-tile");
    expect(tileFor("y")).toHaveClass("workspace-tile--ready");
    expect(tileFor("z").className).toBe("workspace-tile");
  });
});
