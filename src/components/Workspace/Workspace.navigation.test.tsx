/**
 * Shift+Arrow focus navigation + expanded-mode tab switching (RTL + Vitest).
 *
 * The Terminal is mocked to render a `.terminal-pane` element (the real xterm
 * surface lives in that class), because the navigation hook only acts on
 * Shift+Arrow keys that originate inside a terminal pane — so text-selection in
 * real inputs passes through. ipc/commands is mocked so no backend is needed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../../ipc/commands";
import { useSessionsStore } from "../../state/sessionsStore";
import { useUiStore } from "../../state/uiStore";
import { useStatusStore } from "../../state/statusStore";
import { usePausedStore } from "../../state/pausedStore";
import type { SessionInfo } from "../../types";

vi.mock("../../ipc/commands");

// The real xterm surface carries class `terminal-pane`; the nav guard keys on
// it, so the stub must too (and must expose the session id we fire from).
vi.mock("../Terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div
      className="terminal-pane"
      data-testid="terminal-stub"
      data-session-id={sessionId}
    />
  ),
}));

import Workspace from "./Workspace";

const mockedCommands = vi.mocked(commands);
const DIR = "/home/ruben/repo";
const session = (id: string): SessionInfo => ({ id, dirPath: DIR });

function seedSessions(sessions: SessionInfo[]) {
  useSessionsStore.setState({ sessionsByDirectory: { [DIR]: sessions } });
  mockedCommands.listSessions.mockResolvedValue(sessions);
}

/** The mocked terminal-pane element for a session (the keydown origin). */
function paneFor(sessionId: string): HTMLElement {
  return screen
    .getAllByTestId("terminal-stub")
    .find((t) => t.getAttribute("data-session-id") === sessionId)!;
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionsStore.setState({ sessionsByDirectory: {}, namesBySession: {} });
  useUiStore.setState({
    selectedDirectoryPath: DIR,
    focusedSessionId: null,
    expandedSessionId: null,
    commanderOpen: false,
    settingsOpen: false,
    graphOpen: false,
  });
  useStatusStore.setState({ statusBySession: {} });
  usePausedStore.setState({ pausedIds: new Set() });
  mockedCommands.listSessions.mockResolvedValue([]);
});

afterEach(() => {
  // Unmount so the hook's window listener is torn down between tests.
  screen.queryByTestId("workspace-grid"); // touch DOM; RTL auto-cleanup handles unmount
});

// n=3 lays out as rows [2, 1]:  row0 [a, b] / row1 [c]
async function renderThree(focused: string | null) {
  seedSessions([session("a"), session("b"), session("c")]);
  useUiStore.setState({ focusedSessionId: focused });
  render(<Workspace />);
  await waitFor(() =>
    expect(screen.getAllByTestId("workspace-tile")).toHaveLength(3),
  );
}

describe("Shift+Arrow grid navigation", () => {
  it("moves focus to the tile on the right", async () => {
    await renderThree("a");
    fireEvent.keyDown(paneFor("a"), { key: "ArrowRight", shiftKey: true });
    expect(useUiStore.getState().focusedSessionId).toBe("b");
  });

  it("moves focus to the row below (nearest column)", async () => {
    await renderThree("a");
    fireEvent.keyDown(paneFor("a"), { key: "ArrowDown", shiftKey: true });
    expect(useUiStore.getState().focusedSessionId).toBe("c");
  });

  it("sends Ctrl+L (clear screen) to the newly focused session", async () => {
    await renderThree("a");
    fireEvent.keyDown(paneFor("a"), { key: "ArrowRight", shiftKey: true });
    expect(mockedCommands.writeSession).toHaveBeenCalledWith("b", "\f");
  });

  it("does nothing without Shift held (arrow passes through to the terminal)", async () => {
    await renderThree("a");
    fireEvent.keyDown(paneFor("a"), { key: "ArrowRight" });
    expect(useUiStore.getState().focusedSessionId).toBe("a");
  });

  it("ignores Shift+Arrow while an overlay is open", async () => {
    await renderThree("a");
    useUiStore.setState({ commanderOpen: true });
    fireEvent.keyDown(paneFor("a"), { key: "ArrowRight", shiftKey: true });
    expect(useUiStore.getState().focusedSessionId).toBe("a");
  });

  it("ignores Shift+Arrow that does not originate inside a terminal pane", async () => {
    await renderThree("a");
    // Fire from the grid container (an ancestor of the panes, not a pane).
    fireEvent.keyDown(screen.getByTestId("workspace-grid"), {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(useUiStore.getState().focusedSessionId).toBe("a");
  });
});

describe("Shift+Arrow expanded-mode navigation + tabs", () => {
  it("renders a tab per session in the expanded view", async () => {
    seedSessions([session("a"), session("b"), session("c")]);
    useUiStore.setState({ expandedSessionId: "a", focusedSessionId: "a" });
    render(<Workspace />);
    await screen.findByTestId("workspace-expanded");
    expect(screen.getByTestId("expanded-tabs")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("cycles the expanded (and focused) session with Shift+Arrow", async () => {
    seedSessions([session("a"), session("b"), session("c")]);
    useUiStore.setState({ expandedSessionId: "a", focusedSessionId: "a" });
    render(<Workspace />);
    await screen.findByTestId("workspace-expanded");

    fireEvent.keyDown(paneFor("a"), { key: "ArrowRight", shiftKey: true });

    expect(useUiStore.getState().expandedSessionId).toBe("b");
    expect(useUiStore.getState().focusedSessionId).toBe("b");
  });

  it("switches the expanded session when a tab is clicked", async () => {
    useSessionsStore.setState({ namesBySession: { a: "Nova", b: "Orion" } });
    seedSessions([session("a"), session("b")]);
    useUiStore.setState({ expandedSessionId: "a", focusedSessionId: "a" });
    render(<Workspace />);
    await screen.findByTestId("workspace-expanded");

    fireEvent.click(screen.getByRole("tab", { name: "Orion" }));

    expect(useUiStore.getState().expandedSessionId).toBe("b");
    expect(useUiStore.getState().focusedSessionId).toBe("b");
  });
});
