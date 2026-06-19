/**
 * Workspace tests (RTL + Vitest, ipc layer mocked, Terminal mocked).
 *
 * The real Terminal mounts xterm.js (unrenderable under jsdom), so it is
 * replaced with a lightweight stub that records the sessionId it was given.
 * The ipc command layer is mocked so no Tauri backend is required.
 *
 * Covers: add-terminal increments tiles, layout rows for n in {1,4,5,9},
 * expand toggle, focus selection, and per-directory session retention.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../../ipc/commands";
import { useSessionsStore } from "../../state/sessionsStore";
import { useUiStore } from "../../state/uiStore";
import { useStatusStore } from "../../state/statusStore";
import { usePausedStore } from "../../state/pausedStore";
import type { SessionInfo, SessionStatus } from "../../types";

vi.mock("../../ipc/commands");

// Replace the real Terminal (xterm.js) with a stub that records its sessionId.
vi.mock("../Terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-stub" data-session-id={sessionId} />
  ),
}));

import Workspace from "./Workspace";

const mockedCommands = vi.mocked(commands);

const DIR = "/home/ruben/repo";
const OTHER_DIR = "/home/ruben/notes";

const session = (id: string, dirPath = DIR): SessionInfo => ({ id, dirPath });

/**
 * Pre-seed the sessions for the selected directory. The Workspace reloads the
 * selected directory from `listSessions` on mount, so we drive the seed through
 * that mock (and also prime the store) to land the same set of tiles.
 */
function seedSessions(sessions: SessionInfo[], dirPath = DIR) {
  useSessionsStore.setState({ sessionsByDirectory: { [dirPath]: sessions } });
  mockedCommands.listSessions.mockResolvedValue(sessions);
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionsStore.setState({ sessionsByDirectory: {}, namesBySession: {} });
  useUiStore.setState({
    selectedDirectoryPath: DIR,
    focusedSessionId: null,
    expandedSessionId: null,
    collectedOpen: false,
  });
  useStatusStore.setState({ statusBySession: {} });
  usePausedStore.setState({ pausedIds: new Set() });
  // Default: no pre-existing sessions on the backend.
  mockedCommands.listSessions.mockResolvedValue([]);
  // writeSession returns Promise<void> in production; honor that so callers
  // that chain off it (e.g. Clear/Compact's post-command Ctrl+L redraw) work.
  mockedCommands.writeSession.mockResolvedValue(undefined);
});

/** Seed a status record directly, mirroring how sessions/ui stores are seeded. */
function seedStatus(
  sessionId: string,
  status: SessionStatus,
  acknowledged = false,
) {
  useStatusStore.setState((state) => ({
    statusBySession: {
      ...state.statusBySession,
      [sessionId]: { status, acknowledged, promptedSinceAck: false },
    },
  }));
}

function tileFor(sessionId: string): HTMLElement {
  return screen
    .getAllByTestId("workspace-tile")
    .find((t) => t.getAttribute("data-session-id") === sessionId)!;
}

afterEach(() => {
  cleanup();
});

describe("Workspace", () => {
  it("loads the selected directory's sessions from listSessions on mount", async () => {
    mockedCommands.listSessions.mockResolvedValue([session("s1"), session("s2")]);

    render(<Workspace />);

    await waitFor(() => expect(mockedCommands.listSessions).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );
  });

  it("yields its terminals to the collected overlay while the collected view is open", async () => {
    // The terminal pool holds ONE DOM surface per session, and the collected
    // overlay mounts a Terminal for every active session — including this
    // selected directory's. If the Workspace kept its own Terminals mounted
    // behind the overlay, the two mounts would fight over that single surface:
    // the overlay steals it, then closing the overlay removes the shared surface
    // and blanks the grid. So while the collected view is open the Workspace must
    // NOT mount its own terminals — it yields every surface to the overlay.
    mockedCommands.listSessions.mockResolvedValue([session("s1"), session("s2")]);
    useUiStore.setState({ collectedOpen: true });

    render(<Workspace />);

    await waitFor(() => expect(mockedCommands.listSessions).toHaveBeenCalled());
    expect(screen.queryAllByTestId("terminal-stub")).toHaveLength(0);
  });

  it("re-mounts its terminals when the collected view closes", async () => {
    mockedCommands.listSessions.mockResolvedValue([session("s1")]);
    useUiStore.setState({ collectedOpen: true });

    render(<Workspace />);
    await waitFor(() => expect(mockedCommands.listSessions).toHaveBeenCalled());
    expect(screen.queryAllByTestId("terminal-stub")).toHaveLength(0);

    // Closing the overlay returns the surfaces: the grid re-mounts its Terminals
    // (which re-acquire the pooled instances, scrollback intact).
    await act(async () => {
      useUiStore.setState({ collectedOpen: false });
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("terminal-stub")).toHaveLength(1),
    );
  });

  it("auto-spawns a session when the selected directory loads with zero sessions", async () => {
    // Backend reports no live sessions for this directory.
    mockedCommands.listSessions.mockResolvedValue([]);
    mockedCommands.spawnSession.mockResolvedValue(session("auto"));

    render(<Workspace />);

    // Navigating to an empty directory auto-spawns one session (running claude).
    await waitFor(() =>
      expect(mockedCommands.spawnSession).toHaveBeenCalledWith(DIR),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
    );
    // The auto-spawned session takes focus.
    expect(useUiStore.getState().focusedSessionId).toBe("auto");
  });

  it("does not auto-spawn when the directory already has sessions", async () => {
    mockedCommands.listSessions.mockResolvedValue([session("existing")]);

    render(<Workspace />);

    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
    );
    expect(mockedCommands.spawnSession).not.toHaveBeenCalled();
  });

  it("add terminal spawns a session for the selected directory and adds a tile", async () => {
    // Seed an existing session so the empty-directory auto-spawn does not fire;
    // this isolates the manual add-terminal behavior.
    mockedCommands.listSessions.mockResolvedValue([session("existing")]);
    mockedCommands.spawnSession.mockResolvedValue(session("new"));

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add terminal" }));

    await waitFor(() =>
      expect(mockedCommands.spawnSession).toHaveBeenCalledWith(DIR),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );
    // The new session takes focus.
    expect(useUiStore.getState().focusedSessionId).toBe("new");
  });

  it("quick-spawn fills the workspace to the chosen terminal count", async () => {
    // One existing session; clicking "Open 4 terminals" spawns the missing three.
    mockedCommands.listSessions.mockResolvedValue([session("existing")]);
    let n = 0;
    mockedCommands.spawnSession.mockImplementation(async () =>
      session(`new-${n++}`),
    );

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open 4 terminals" }));

    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(4),
    );
    expect(mockedCommands.spawnSession).toHaveBeenCalledTimes(3);
    // Focus lands on the last spawned terminal.
    expect(useUiStore.getState().focusedSessionId).toBe("new-2");
  });

  it("hides a quick-spawn option once the workspace already has that many", async () => {
    seedSessions([session("a"), session("b")]);

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    // Two terminals open: the "2" target is reached and gone, "4" remains.
    expect(
      screen.queryByRole("button", { name: "Open 2 terminals" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open 4 terminals" }),
    ).toBeInTheDocument();
  });

  describe("layout rows match computeGridLayout", () => {
    const cases: Array<{ n: number; rows: number[] }> = [
      { n: 1, rows: [1] },
      { n: 2, rows: [2] }, // two panes side by side in a single row
      { n: 4, rows: [2, 2] },
      { n: 5, rows: [3, 2] },
      { n: 9, rows: [5, 4] },
    ];

    for (const { n, rows } of cases) {
      it(`n=${n} renders ${rows.length} row(s) with counts ${rows.join("/")}`, async () => {
        seedSessions(Array.from({ length: n }, (_, i) => session(`s${i}`)));

        render(<Workspace />);
        await waitFor(() =>
          expect(screen.getAllByTestId("workspace-tile")).toHaveLength(n),
        );

        const rowEls = screen.getAllByTestId("workspace-grid-row");
        expect(rowEls).toHaveLength(rows.length);
        const counts = rowEls.map(
          (row) => row.querySelectorAll('[data-testid="workspace-tile"]').length,
        );
        expect(counts).toEqual(rows);
      });
    }
  });

  it("clicking a tile focuses its session", async () => {
    seedSessions([session("a"), session("b")]);

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    const tileB = screen
      .getAllByTestId("workspace-tile")
      .find((t) => t.getAttribute("data-session-id") === "b")!;
    fireEvent.click(tileB);

    expect(useUiStore.getState().focusedSessionId).toBe("b");
    expect(tileB).toHaveAttribute("data-focused", "true");
  });

  it("clicking a non-focused tile sends Ctrl+L (clear screen) to its session", async () => {
    seedSessions([session("a"), session("b")]);

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    const tileB = screen
      .getAllByTestId("workspace-tile")
      .find((t) => t.getAttribute("data-session-id") === "b")!;
    fireEvent.click(tileB);

    // "\f" (0x0C) is the Ctrl+L form-feed byte: switching INTO a terminal
    // clears its screen.
    expect(mockedCommands.writeSession).toHaveBeenCalledWith("b", "\f");
  });

  it("clicking the already-focused tile does not re-send Ctrl+L", async () => {
    seedSessions([session("a"), session("b")]);
    useUiStore.setState({ focusedSessionId: "b", expandedSessionId: null });

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    const tileB = screen
      .getAllByTestId("workspace-tile")
      .find((t) => t.getAttribute("data-session-id") === "b")!;
    fireEvent.click(tileB);

    // It is already focused — no focus switch, so no clear.
    expect(mockedCommands.writeSession).not.toHaveBeenCalledWith("b", "\f");
  });

  it("expanding a tile fills the workspace and collapsing returns to the grid", async () => {
    seedSessions([session("a"), session("b")]);

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand session a" }));

    expect(useUiStore.getState().expandedSessionId).toBe("a");
    expect(screen.getByTestId("workspace-expanded")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-grid")).not.toBeInTheDocument();
    // The expanded view shows exactly the expanded session's Terminal.
    const stubs = screen.getAllByTestId("terminal-stub");
    expect(stubs).toHaveLength(1);
    expect(stubs[0]).toHaveAttribute("data-session-id", "a");

    fireEvent.click(screen.getByRole("button", { name: "Collapse session" }));

    expect(useUiStore.getState().expandedSessionId).toBeNull();
    expect(screen.queryByTestId("workspace-expanded")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );
  });

  it("grid-tile Clear/Compact route writeSession to that tile's session id (non-focused tile)", async () => {
    seedSessions([session("a"), session("b")]);

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    // No tile is focused yet; act on tile "b" directly.
    expect(useUiStore.getState().focusedSessionId).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear session b" }));
    expect(mockedCommands.writeSession).toHaveBeenCalledWith("b", "/clear\r");

    fireEvent.click(screen.getByRole("button", { name: "Compact session b" }));
    expect(mockedCommands.writeSession).toHaveBeenCalledWith("b", "/compact\r");

    // Acting on the actions did not require focusing the tile first.
    expect(useUiStore.getState().focusedSessionId).toBeNull();
  });

  it("grid-tile Close removes the tile and clears focus/expand state", async () => {
    seedSessions([session("a"), session("b")]);
    useUiStore.setState({ focusedSessionId: "a", expandedSessionId: null });

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close session a" }));

    expect(mockedCommands.killSession).toHaveBeenCalledWith("a");
    await waitFor(() =>
      expect(
        useSessionsStore.getState().sessionsByDirectory[DIR],
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
    );
    expect(
      screen.getByTestId("workspace-tile").getAttribute("data-session-id"),
    ).toBe("b");
    // The closed session was focused, so focus is cleared.
    expect(useUiStore.getState().focusedSessionId).toBeNull();
  });

  it("expanded-view Clear/Compact route writeSession to the expanded session", async () => {
    seedSessions([session("a"), session("b")]);

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand session a" }));
    expect(screen.getByTestId("workspace-expanded")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear session a" }));
    expect(mockedCommands.writeSession).toHaveBeenCalledWith("a", "/clear\r");

    fireEvent.click(screen.getByRole("button", { name: "Compact session a" }));
    expect(mockedCommands.writeSession).toHaveBeenCalledWith("a", "/compact\r");
  });

  it("expanded-view Close removes the session and clears expand/focus state", async () => {
    seedSessions([session("a"), session("b")]);
    useUiStore.setState({ focusedSessionId: "a", expandedSessionId: null });

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand session a" }));
    expect(useUiStore.getState().expandedSessionId).toBe("a");

    fireEvent.click(screen.getByRole("button", { name: "Close session a" }));

    expect(mockedCommands.killSession).toHaveBeenCalledWith("a");
    await waitFor(() =>
      expect(
        useSessionsStore.getState().sessionsByDirectory[DIR],
      ).toHaveLength(1),
    );
    // Both expand and focus pointed at the closed session, so both clear and
    // the view falls back to the grid.
    expect(useUiStore.getState().expandedSessionId).toBeNull();
    expect(useUiStore.getState().focusedSessionId).toBeNull();
    await waitFor(() =>
      expect(screen.queryByTestId("workspace-expanded")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
    );
  });

  it("keeps other directories' sessions when switching the selected directory", async () => {
    // OTHER_DIR already has a session in the store; DIR loads its own.
    useSessionsStore.setState({
      sessionsByDirectory: { [OTHER_DIR]: [session("other-1", OTHER_DIR)] },
    });
    // The real backend returns ALL sessions; loadDirectory filters per dir.
    mockedCommands.listSessions.mockResolvedValue([
      session("dir-1", DIR),
      session("other-1", OTHER_DIR),
    ]);

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
    );
    expect(
      screen.getByTestId("workspace-tile").getAttribute("data-session-id"),
    ).toBe("dir-1");

    // Switch to the other directory: DIR's loaded session and OTHER_DIR's
    // pre-existing session both remain in the store (neither is destroyed).
    act(() => {
      useUiStore.getState().setSelectedDirectoryPath(OTHER_DIR);
    });

    await waitFor(() =>
      expect(
        useSessionsStore.getState().sessionsByDirectory[OTHER_DIR],
      ).toHaveLength(1),
    );
    expect(
      useSessionsStore.getState().sessionsByDirectory[DIR],
    ).toHaveLength(1);
  });

  describe("status borders", () => {
    it("renders the matching status class for each status on its grid tile", async () => {
      seedSessions([
        session("ready-s"),
        session("approval-s"),
        session("error-s"),
        session("working-s"),
        session("none-s"),
      ]);
      seedStatus("ready-s", "ready");
      seedStatus("approval-s", "awaiting-approval");
      seedStatus("error-s", "error");
      seedStatus("working-s", "working");
      // none-s intentionally has no status entry.

      render(<Workspace />);
      await waitFor(() =>
        expect(screen.getAllByTestId("workspace-tile")).toHaveLength(5),
      );

      expect(tileFor("ready-s")).toHaveClass("workspace-tile--ready");
      expect(tileFor("approval-s")).toHaveClass(
        "workspace-tile--awaiting-approval",
      );
      expect(tileFor("error-s")).toHaveClass("workspace-tile--error");

      // working and no-entry → neutral default (no status class).
      expect(tileFor("working-s").className).toBe("workspace-tile");
      expect(tileFor("none-s").className).toBe("workspace-tile");
    });

    it("FOCUS WINS: a focused tile shows --focused and no status color", async () => {
      seedSessions([session("a")]);
      seedStatus("a", "error");
      useUiStore.setState({ focusedSessionId: "a" });

      render(<Workspace />);
      await waitFor(() =>
        expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
      );

      const tile = tileFor("a");
      expect(tile).toHaveClass("workspace-tile--focused");
      expect(tile).not.toHaveClass("workspace-tile--error");
    });

    it("clears a ready tile to neutral once it is acknowledged", async () => {
      seedSessions([session("a")]);
      seedStatus("a", "ready", true);

      render(<Workspace />);
      await waitFor(() =>
        expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
      );

      const tile = tileFor("a");
      // Acknowledged ready no longer carries any status color — the blink window
      // has elapsed (or the user focused it), so the border returns to neutral.
      expect(tile.className).toBe("workspace-tile");
      expect(tile).not.toHaveClass("workspace-tile--ready");
      expect(tile).not.toHaveClass("workspace-tile--ready-seen");
    });

    it("applies the status class to the expanded tile", async () => {
      seedSessions([session("a"), session("b")]);
      seedStatus("a", "awaiting-approval");
      useUiStore.setState({ expandedSessionId: "a" });

      render(<Workspace />);
      const expandedTile = await screen.findByTestId("workspace-expanded");
      expect(expandedTile).toHaveClass("workspace-tile--awaiting-approval");
    });

    it("FOCUS WINS on the expanded tile too", async () => {
      seedSessions([session("a")]);
      seedStatus("a", "error");
      useUiStore.setState({ expandedSessionId: "a", focusedSessionId: "a" });

      render(<Workspace />);
      const expandedTile = await screen.findByTestId("workspace-expanded");
      expect(expandedTile).toHaveClass("workspace-tile--focused");
      expect(expandedTile).not.toHaveClass("workspace-tile--error");
    });
  });

  describe("session names", () => {
    it("renders each session's codename in its grid tile", async () => {
      seedSessions([session("a"), session("b")]);
      useSessionsStore.setState({ namesBySession: { a: "Nova", b: "Orion" } });

      render(<Workspace />);
      await waitFor(() =>
        expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
      );

      expect(within(tileFor("a")).getByText("Nova")).toBeInTheDocument();
      expect(within(tileFor("b")).getByText("Orion")).toBeInTheDocument();
    });

    it("renders the codename in the expanded tile", async () => {
      seedSessions([session("a"), session("b")]);
      useSessionsStore.setState({ namesBySession: { a: "Vega", b: "Atlas" } });
      useUiStore.setState({ expandedSessionId: "a" });

      render(<Workspace />);
      const expanded = await screen.findByTestId("workspace-expanded");

      expect(within(expanded).getByText("Vega")).toBeInTheDocument();
    });
  });

  it("marks a paused session's tile and resumes it from the tile control", async () => {
    seedSessions([session("a"), session("b")]);

    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
    );

    act(() => usePausedStore.getState().setPaused("a", true));

    expect(tileFor("a")).toHaveClass("workspace-tile--paused");
    expect(tileFor("b")).not.toHaveClass("workspace-tile--paused");

    fireEvent.click(screen.getByRole("button", { name: "Resume session a" }));
    expect(mockedCommands.setSessionPaused).toHaveBeenCalledWith("a", false);
  });

  describe("focus reconciliation on workspace switch", () => {
    it("moves focus to the workspace's first session when entering with stale cross-directory focus", async () => {
      // Focus still points at a pane from the workspace we just left (focus is
      // global and the switch never moved it). The new workspace must adopt one
      // of its own sessions so keystrokes land here without a manual click.
      seedSessions([session("a"), session("b")]);
      useUiStore.setState({ focusedSessionId: "stale-from-other-dir" });

      render(<Workspace />);
      await waitFor(() =>
        expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
      );

      await waitFor(() =>
        expect(useUiStore.getState().focusedSessionId).toBe("a"),
      );
      expect(tileFor("a")).toHaveAttribute("data-focused", "true");
    });

    it("adopts the valid expanded session, not the first tile, when reconciling", async () => {
      seedSessions([session("a"), session("b")]);
      // Expanded points at a real session here; focus is stale. Reconciling must
      // land on the expanded pane so its border + DOM focus stay consistent.
      useUiStore.setState({
        focusedSessionId: "stale-from-other-dir",
        expandedSessionId: "b",
      });

      render(<Workspace />);
      await screen.findByTestId("workspace-expanded");

      await waitFor(() =>
        expect(useUiStore.getState().focusedSessionId).toBe("b"),
      );
    });

    it("leaves focus untouched when it already belongs to this workspace", async () => {
      seedSessions([session("a"), session("b")]);
      useUiStore.setState({ focusedSessionId: "b" });

      render(<Workspace />);
      await waitFor(() =>
        expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
      );

      expect(useUiStore.getState().focusedSessionId).toBe("b");
    });

    it("does not auto-focus a fresh workspace that had no prior focus", async () => {
      // Null focus is the genuine "nothing selected yet" state (startup, or just
      // closed the focused pane); status borders depend on it, so leave it alone.
      seedSessions([session("a"), session("b")]);
      // focusedSessionId starts null (see beforeEach).

      render(<Workspace />);
      await waitFor(() =>
        expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
      );

      expect(useUiStore.getState().focusedSessionId).toBeNull();
    });

    it("reconciling does not clear the adopted pane's screen (no Ctrl+L)", async () => {
      seedSessions([session("a"), session("b")]);
      useUiStore.setState({ focusedSessionId: "stale-from-other-dir" });

      render(<Workspace />);
      await waitFor(() =>
        expect(useUiStore.getState().focusedSessionId).toBe("a"),
      );

      // Reconcile only re-routes input; it must not redraw the pane the way an
      // explicit tile click (which sends Ctrl+L) does.
      expect(mockedCommands.writeSession).not.toHaveBeenCalledWith("a", "\f");
    });

    it("reconciles focus when the selected directory changes at runtime", async () => {
      useSessionsStore.setState({
        sessionsByDirectory: { [OTHER_DIR]: [session("other-1", OTHER_DIR)] },
      });
      mockedCommands.listSessions.mockResolvedValue([
        session("dir-1", DIR),
        session("other-1", OTHER_DIR),
      ]);
      useUiStore.setState({ focusedSessionId: "dir-1" });

      render(<Workspace />);
      await waitFor(() =>
        expect(screen.getAllByTestId("workspace-tile")).toHaveLength(1),
      );

      act(() => {
        useUiStore.getState().setSelectedDirectoryPath(OTHER_DIR);
      });

      // Focus followed the switch onto OTHER_DIR's own session.
      await waitFor(() =>
        expect(useUiStore.getState().focusedSessionId).toBe("other-1"),
      );
    });
  });
});
