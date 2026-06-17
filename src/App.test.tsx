import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { listDirectories, spawnCommanderSession } from "./ipc/commands";
import {
  onCommanderDirectoriesChanged,
  onCommanderNavigate,
  onSessionExit,
  onSessionOutput,
} from "./ipc/events";
import { useDirectoriesStore } from "./state/directoriesStore";
import { useSettingsStore } from "./state/settingsStore";
import { useSessionsStore } from "./state/sessionsStore";
import { useUiStore } from "./state/uiStore";
import type { DirectoryInfo } from "./types";

// The TitleBar drives the native window via this wrapper; stub it so the shell
// renders without a live Tauri window (no __TAURI_INTERNALS__ under jsdom).
vi.mock("./ipc/window", () => ({
  minimizeWindow: vi.fn().mockResolvedValue(undefined),
  toggleMaximizeWindow: vi.fn().mockResolvedValue(undefined),
  closeWindow: vi.fn().mockResolvedValue(undefined),
  isWindowMaximized: vi.fn().mockResolvedValue(false),
  onWindowResized: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("./ipc/commands", () => ({
  listDirectories: vi.fn().mockResolvedValue([]),
  listSessions: vi.fn().mockResolvedValue([]),
  addDirectory: vi.fn().mockResolvedValue(undefined),
  removeDirectory: vi.fn().mockResolvedValue(undefined),
  spawnSession: vi
    .fn()
    .mockResolvedValue({ id: "auto", dirPath: "/home/ruben/projects/foo" }),
  writeSession: vi.fn().mockResolvedValue(undefined),
  resizeSession: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn().mockResolvedValue(undefined),
  spawnCommanderSession: vi
    .fn()
    .mockResolvedValue({ id: "cmd-1", dirPath: "/home/ruben", kind: "commander" }),
  // UsageBar (mounted in the shell) primes via getUsage() on mount. A pending
  // promise keeps the prime from scheduling a post-render store update that
  // would escape act() in these synchronous shell tests.
  getUsage: vi.fn(() => new Promise(() => {})),
}));

// Capture the handlers passed to the commander event subscriptions so tests can
// fire the events.
let navigateHandler: ((path: string) => void) | undefined;
let directoriesChangedHandler: (() => void) | undefined;
let exitHandler: ((p: { sessionId: string; code: number }) => void) | undefined;

// The real Terminal mounts xterm.js (canvas, unrenderable under jsdom). App
// shell tests don't exercise terminal internals, so stub it — the auto-spawn
// on directory selection would otherwise mount a real xterm and crash.
vi.mock("./components/Terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-stub" data-session-id={sessionId} />
  ),
}));

vi.mock("./ipc/events", () => ({
  onSessionOutput: vi.fn().mockResolvedValue(() => {}),
  onSessionExit: vi.fn((cb: (p: { sessionId: string; code: number }) => void) => {
    exitHandler = cb;
    return Promise.resolve(() => {});
  }),
  onCommanderNavigate: vi.fn((cb: (path: string) => void) => {
    navigateHandler = cb;
    return Promise.resolve(() => {});
  }),
  onCommanderDirectoriesChanged: vi.fn((cb: () => void) => {
    directoriesChangedHandler = cb;
    return Promise.resolve(() => {});
  }),
  // UsageBar (mounted in the shell) subscribes to usage://updated on mount.
  onUsageUpdated: vi.fn().mockResolvedValue(() => {}),
}));

describe("App shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateHandler = undefined;
    directoriesChangedHandler = undefined;
    exitHandler = undefined;
    // Restore default mock return values that individual tests may have overridden
    // (vi.clearAllMocks() clears call records but not implementations).
    vi.mocked(listDirectories).mockResolvedValue([]);
    // Reset shared store state between tests so leaked directory/session data
    // from one test does not trigger auto-spawn effects in subsequent tests.
    useUiStore.setState({
      selectedDirectoryPath: null,
      commanderOpen: false,
      settingsOpen: false,
    });
    useDirectoriesStore.setState({ directories: [] });
    useSessionsStore.setState({ sessionsByDirectory: {} });
  });

  it("renders the sidebar and workspace panes", async () => {
    render(<App />);
    expect(screen.getByLabelText("Workspaces")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace")).toBeInTheDocument();
    // Flush the Sidebar's async mount load so its state update lands inside act.
    await act(async () => {});
  });

  it("mounts the status engine once (subscribes to output and exit)", () => {
    render(<App />);
    expect(onSessionOutput).toHaveBeenCalledTimes(1);
    // StatusEngine subscribes once + App's Commander-exit subscription = 2 total.
    expect(onSessionExit).toHaveBeenCalledTimes(2);
  });

  it("shows the Commander overlay when open (folded out)", () => {
    useUiStore.setState({ commanderOpen: true });
    render(<App />);
    expect(
      screen.getByRole("dialog", { name: "Commander" }),
    ).toBeInTheDocument();
  });

  it("mounts the Settings drawer inside .app-body, not the sidebar", async () => {
    // Regression: the drawer is `position: absolute; right: 0`. Mounted inside
    // the 260px `.sidebar` it anchored to the sidebar's edge and spilled off the
    // left of the window. It must resolve against the full-width `.app-body`.
    useSettingsStore.setState({
      settings: { workspaceRoot: "/home/ruben/dev" },
      load: vi.fn().mockResolvedValue(undefined),
      setWorkspaceRoot: vi.fn().mockResolvedValue(undefined),
    });
    useUiStore.setState({ settingsOpen: true });
    render(<App />);

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const appBody = document.querySelector(".app-body");
    const sidebar = screen.getByLabelText("Workspaces");

    expect(appBody).not.toBeNull();
    expect(appBody).toContainElement(dialog);
    expect(sidebar).not.toContainElement(dialog);
    await act(async () => {});
  });

  it("auto-selects the most-recently-modified workspace once loaded", async () => {
    const older: DirectoryInfo = {
      path: "/home/ruben/dev/older",
      name: "older",
      isGitRepo: false,
      branch: null,
      lastModified: 100,
    };
    const newer: DirectoryInfo = {
      path: "/home/ruben/dev/newer",
      name: "newer",
      isGitRepo: true,
      branch: "main",
      lastModified: 999,
    };
    vi.mocked(listDirectories).mockResolvedValue([older, newer]);

    render(<App />);

    await waitFor(() =>
      expect(useUiStore.getState().selectedDirectoryPath).toBe(
        "/home/ruben/dev/newer",
      ),
    );

    // Auto-selecting a workspace triggers the Workspace auto-spawn effect; wait
    // for it to settle so its async state updates flush inside act (no warnings).
    await waitFor(() =>
      expect(useUiStore.getState().focusedSessionId).toBe("auto"),
    );
  });

  it("toggles the Commander overlay with Ctrl+Shift+C", async () => {
    render(<App />);
    expect(screen.queryByRole("dialog", { name: "Commander" })).toBeNull();

    fireEvent.keyDown(window, { key: "C", ctrlKey: true, shiftKey: true });
    expect(
      screen.getByRole("dialog", { name: "Commander" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "C", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog", { name: "Commander" })).toBeNull();
    // Flush the Sidebar's async mount load so its state update lands inside act.
    await act(async () => {});
  });

  it("subscribes to commander://navigate and selects the resolved directory", async () => {
    render(<App />);
    await waitFor(() => expect(onCommanderNavigate).toHaveBeenCalledTimes(1));

    act(() => navigateHandler?.("/home/ruben/projects/foo"));

    expect(useUiStore.getState().selectedDirectoryPath).toBe(
      "/home/ruben/projects/foo",
    );

    // Selecting a directory triggers the Workspace's auto-spawn effect; wait for
    // it to settle so its async state updates flush inside act (no warnings).
    await waitFor(() =>
      expect(useUiStore.getState().focusedSessionId).toBe("auto"),
    );
  });

  it("reloads the directory list on commander://directories-changed", async () => {
    render(<App />);
    await waitFor(() =>
      expect(onCommanderDirectoriesChanged).toHaveBeenCalledTimes(1),
    );

    // listDirectories was already called by the Sidebar's mount load.
    const before = vi.mocked(listDirectories).mock.calls.length;

    act(() => directoriesChangedHandler?.());

    // The event triggers another fetch so a Commander-driven add/remove shows up.
    await waitFor(() =>
      expect(vi.mocked(listDirectories).mock.calls.length).toBeGreaterThan(
        before,
      ),
    );
  });

  it("spawns the Commander terminal lazily on first open (not on boot)", async () => {
    render(<App />);
    expect(spawnCommanderSession).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "C", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(spawnCommanderSession).toHaveBeenCalledTimes(1));

    const term = await screen.findByTestId("terminal-stub");
    expect(term).toHaveAttribute("data-session-id", "cmd-1");
  });

  it("shows the relaunch affordance after the Commander session exits", async () => {
    useUiStore.setState({ commanderOpen: true });
    render(<App />);
    await screen.findByTestId("terminal-stub");

    act(() => exitHandler?.({ sessionId: "cmd-1", code: 0 }));

    expect(
      await screen.findByRole("button", { name: "Relaunch Commander" }),
    ).toBeInTheDocument();
  });
});
