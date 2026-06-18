/**
 * ExpandedTabs tests (RTL + Vitest). Presentational: reads names/status/paused
 * from stores, takes the session list, active id, and onSelect as props.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionsStore } from "../../state/sessionsStore";
import { useStatusStore } from "../../state/statusStore";
import { usePausedStore } from "../../state/pausedStore";
import type { SessionInfo, SessionStatus } from "../../types";

import { ExpandedTabs } from "./ExpandedTabs";

const session = (id: string): SessionInfo => ({ id, dirPath: "/d" });

beforeEach(() => {
  useSessionsStore.setState({ namesBySession: {} });
  useStatusStore.setState({ statusBySession: {} });
  usePausedStore.setState({ pausedIds: new Set() });
});

afterEach(cleanup);

function seedStatus(id: string, status: SessionStatus, acknowledged = false) {
  useStatusStore.setState((s) => ({
    statusBySession: {
      ...s.statusBySession,
      [id]: { status, acknowledged, promptedSinceAck: false },
    },
  }));
}

describe("ExpandedTabs", () => {
  it("renders one tab per session showing its codename", () => {
    useSessionsStore.setState({ namesBySession: { a: "Nova", b: "Orion" } });

    render(
      <ExpandedTabs
        sessions={[session("a"), session("b")]}
        activeSessionId="a"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "Nova" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Orion" })).toBeInTheDocument();
  });

  it("marks the active session's tab as selected", () => {
    useSessionsStore.setState({ namesBySession: { a: "Nova", b: "Orion" } });

    render(
      <ExpandedTabs
        sessions={[session("a"), session("b")]}
        activeSessionId="b"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "Orion" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Nova" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("calls onSelect with the clicked session id", () => {
    useSessionsStore.setState({ namesBySession: { a: "Nova", b: "Orion" } });
    const onSelect = vi.fn();

    render(
      <ExpandedTabs
        sessions={[session("a"), session("b")]}
        activeSessionId="a"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Orion" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("shows the status color on a non-active session's tab", () => {
    useSessionsStore.setState({ namesBySession: { a: "Nova", b: "Orion" } });
    seedStatus("b", "awaiting-approval");

    render(
      <ExpandedTabs
        sessions={[session("a"), session("b")]}
        activeSessionId="a"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "Orion" })).toHaveClass(
      "expanded-tab--awaiting-approval",
    );
  });

  it("FOCUS WINS: the active tab shows the active style and no status color", () => {
    useSessionsStore.setState({ namesBySession: { a: "Nova" } });
    seedStatus("a", "error");

    render(
      <ExpandedTabs
        sessions={[session("a")]}
        activeSessionId="a"
        onSelect={() => {}}
      />,
    );

    const tab = screen.getByRole("tab", { name: "Nova" });
    expect(tab).toHaveClass("expanded-tab--active");
    expect(tab).not.toHaveClass("expanded-tab--error");
  });

  it("marks a paused session's tab", () => {
    useSessionsStore.setState({ namesBySession: { a: "Nova", b: "Orion" } });
    usePausedStore.setState({ pausedIds: new Set(["b"]) });

    render(
      <ExpandedTabs
        sessions={[session("a"), session("b")]}
        activeSessionId="a"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole("tab", { name: "Orion" })).toHaveClass(
      "expanded-tab--paused",
    );
  });
});
