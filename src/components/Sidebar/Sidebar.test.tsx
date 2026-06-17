/**
 * Sidebar tests (RTL + Vitest, ipc layer mocked).
 *
 * Covers: list render on mount, branch shown for git repos vs. hidden for
 * non-git, the `+` add flow, and selection updating `uiStore`.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../../ipc/commands";
import { useDirectoriesStore } from "../../state/directoriesStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useSettingsStore } from "../../state/settingsStore";
import { useUiStore } from "../../state/uiStore";
import type { DirectoryInfo, DiscoveredDir, SessionInfo } from "../../types";

import Sidebar from "./Sidebar";

vi.mock("../../ipc/commands");

const NOW_SECS = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

const gitDir: DirectoryInfo = {
  path: "/home/ruben/repo",
  name: "repo",
  isGitRepo: true,
  branch: "main",
  // Edited recently: fresh, not stale.
  lastModified: NOW_SECS - 3 * DAY,
};

const plainDir: DirectoryInfo = {
  path: "/home/ruben/notes",
  name: "notes",
  isGitRepo: false,
  branch: null,
  // Edited long ago: past the 7-day stale threshold.
  lastModified: NOW_SECS - 30 * DAY,
};

// Discovery candidates surfaced in the add combobox. Names are deliberately
// distinct from the managed dirs (repo/notes) to avoid text collisions.
const candidates: DiscoveredDir[] = [
  {
    path: "/home/ruben/dev/alpha",
    name: "alpha",
    isGitRepo: true,
    branch: "main",
    lastModified: null,
    alreadyManaged: false,
  },
  {
    path: "/home/ruben/dev/beta",
    name: "beta",
    isGitRepo: false,
    branch: null,
    lastModified: null,
    alreadyManaged: false,
  },
  {
    path: "/home/ruben/dev/gamma",
    name: "gamma",
    isGitRepo: true,
    branch: "dev",
    lastModified: null,
    alreadyManaged: true,
  },
];

const mockedCommands = vi.mocked(commands);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset stores between tests.
  useDirectoriesStore.setState({ directories: [] });
  useSessionsStore.setState({ sessionsByDirectory: {} });
  useUiStore.setState({
    selectedDirectoryPath: null,
    focusedSessionId: null,
    expandedSessionId: null,
    settingsOpen: false,
  });
  // Stub the settings store actions so the panel's open-time load() is inert.
  useSettingsStore.setState({
    settings: { workspaceRoot: "/home/ruben/dev" },
    load: vi.fn().mockResolvedValue(undefined),
    setWorkspaceRoot: vi.fn().mockResolvedValue(undefined),
  });
  mockedCommands.listDirectories.mockResolvedValue([gitDir, plainDir]);
  mockedCommands.removeDirectory.mockResolvedValue(undefined);
  mockedCommands.killSession.mockResolvedValue(undefined);
  mockedCommands.discoverDirectories.mockResolvedValue(candidates);
});

afterEach(() => {
  cleanup();
});

describe("Sidebar", () => {
  it("loads and renders directories on mount", async () => {
    render(<Sidebar />);

    expect(mockedCommands.listDirectories).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("repo")).toBeInTheDocument();
    expect(screen.getByText("notes")).toBeInTheDocument();
    expect(screen.getByText("/home/ruben/repo")).toBeInTheDocument();
  });

  it("shows the branch for git repos and hides it for non-git directories", async () => {
    render(<Sidebar />);

    expect(await screen.findByText("main")).toBeInTheDocument();

    // Only the git repo has a branch line; the plain dir contributes none.
    const branchNodes = screen
      .getAllByText(/./)
      .filter((el) => el.className === "sidebar-directory-branch");
    expect(branchNodes).toHaveLength(1);
    expect(branchNodes[0]).toHaveTextContent("main");
  });

  it("adds a directory via the + button and shows it in the list", async () => {
    const newDir: DirectoryInfo = {
      path: "/home/ruben/added",
      name: "added",
      isGitRepo: false,
      branch: null,
      lastModified: null,
    };
    mockedCommands.addDirectory.mockResolvedValue(newDir);

    render(<Sidebar />);
    await screen.findByText("repo");

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));

    const input = screen.getByLabelText("Workspace path");
    fireEvent.change(input, { target: { value: "/home/ruben/added" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mockedCommands.addDirectory).toHaveBeenCalledWith(
        "/home/ruben/added",
      ),
    );
    expect(await screen.findByText("added")).toBeInTheDocument();
  });

  it("opens the add combobox and lists discovered candidates", async () => {
    render(<Sidebar />);
    await screen.findByText("repo");

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));

    await waitFor(() =>
      expect(mockedCommands.discoverDirectories).toHaveBeenCalled(),
    );
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /alpha/ })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /beta/ })).toBeInTheDocument();
  });

  it("filters discovered candidates as you type in the input", async () => {
    render(<Sidebar />);
    await screen.findByText("repo");
    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    const listbox = await screen.findByRole("listbox");

    fireEvent.change(screen.getByLabelText("Workspace path"), {
      target: { value: "alph" },
    });

    expect(within(listbox).getByRole("option", { name: /alpha/ })).toBeInTheDocument();
    expect(
      within(listbox).queryByRole("option", { name: /beta/ }),
    ).not.toBeInTheDocument();
  });

  it("adds a discovered candidate when its dropdown entry is clicked", async () => {
    mockedCommands.addDirectory.mockResolvedValue({
      ...candidates[0],
      lastModified: null,
    });
    render(<Sidebar />);
    await screen.findByText("repo");
    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    const listbox = await screen.findByRole("listbox");

    fireEvent.click(within(listbox).getByRole("option", { name: /alpha/ }));

    await waitFor(() =>
      expect(mockedCommands.addDirectory).toHaveBeenCalledWith(
        "/home/ruben/dev/alpha",
      ),
    );
  });

  it("does not display already-managed candidates", async () => {
    render(<Sidebar />);
    await screen.findByText("repo");
    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    const listbox = await screen.findByRole("listbox");

    // alpha/beta are unmanaged and offered; gamma is already managed and hidden
    // (you can't add what's already there).
    expect(
      within(listbox).getByRole("option", { name: /alpha/ }),
    ).toBeInTheDocument();
    expect(
      within(listbox).queryByRole("option", { name: /gamma/ }),
    ).not.toBeInTheDocument();
  });

  it("primes discovery on mount so the combobox opens instantly", async () => {
    render(<Sidebar />);

    // Discovery runs in the background on mount — before the user ever clicks
    // "+" — so the dropdown is already populated when they open it.
    await waitFor(() =>
      expect(mockedCommands.discoverDirectories).toHaveBeenCalled(),
    );
  });

  it("shows a loading indicator while discovery is still running", async () => {
    // A discovery that never resolves keeps the combobox in its loading state.
    mockedCommands.discoverDirectories.mockImplementation(
      () => new Promise<DiscoveredDir[]>(() => {}),
    );
    render(<Sidebar />);
    await screen.findByText("repo");

    fireEvent.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(screen.getByText(/scanning/i)).toBeInTheDocument();
  });

  it("selects a directory, updating uiStore.selectedDirectoryPath", async () => {
    render(<Sidebar />);
    const repoButton = (await screen.findByText("repo")).closest("button");
    expect(repoButton).not.toBeNull();

    fireEvent.click(repoButton as HTMLButtonElement);

    expect(useUiStore.getState().selectedDirectoryPath).toBe(
      "/home/ruben/repo",
    );
    expect(repoButton).toHaveAttribute("aria-current", "true");
  });

  it("renders an edited-ago label from lastModified", async () => {
    render(<Sidebar />);
    // Fresh repo edited 3 days ago.
    expect(await screen.findByText("edited 3d ago")).toBeInTheDocument();
  });

  it("applies a stale style once past the threshold", async () => {
    render(<Sidebar />);
    await screen.findByText("notes");

    // The plain dir (edited 30d ago) is stale; the repo (3d ago) is not.
    const staleNodes = screen
      .getAllByText(/edited/)
      .filter((el) =>
        el.className.includes("sidebar-directory-edited--stale"),
      );
    expect(staleNodes).toHaveLength(1);
    expect(staleNodes[0]).toHaveTextContent("edited 30d ago");
  });

  it("removes a directory directly when it has no active sessions", async () => {
    render(<Sidebar />);
    await screen.findByText("repo");

    fireEvent.click(screen.getByRole("button", { name: "Remove repo" }));

    await waitFor(() =>
      expect(mockedCommands.removeDirectory).toHaveBeenCalledWith(
        "/home/ruben/repo",
      ),
    );
    // No sessions => no confirm, no kills.
    expect(mockedCommands.killSession).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText("repo")).not.toBeInTheDocument(),
    );
  });

  it("confirms and kills active sessions before removing", async () => {
    const sessions: SessionInfo[] = [
      { id: "s1", dirPath: "/home/ruben/repo" },
      { id: "s2", dirPath: "/home/ruben/repo" },
    ];
    useSessionsStore.setState({
      sessionsByDirectory: { "/home/ruben/repo": sessions },
    });

    render(<Sidebar />);
    await screen.findByText("repo");

    fireEvent.click(screen.getByRole("button", { name: "Remove repo" }));

    // Confirm dialog appears with the live-session count; nothing removed yet.
    expect(
      await screen.findByText(/has 2 live sessions/),
    ).toBeInTheDocument();
    expect(mockedCommands.removeDirectory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(mockedCommands.removeDirectory).toHaveBeenCalledWith(
        "/home/ruben/repo",
      ),
    );
    expect(mockedCommands.killSession).toHaveBeenCalledTimes(2);
    expect(mockedCommands.killSession).toHaveBeenCalledWith("s1");
    expect(mockedCommands.killSession).toHaveBeenCalledWith("s2");
  });

  it("requests the settings drawer via the gear control", async () => {
    // The drawer itself is mounted by App in `.app-body` (so its `right: 0`
    // anchors to the full window, not the sidebar). The Sidebar only owns the
    // gear, which flips the shared uiStore flag App reads.
    render(<Sidebar />);
    await screen.findByText("repo");

    const gear = screen.getByRole("button", { name: "Settings" });
    expect(gear).toHaveAttribute("aria-expanded", "false");
    expect(useUiStore.getState().settingsOpen).toBe(false);

    fireEvent.click(gear);

    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(gear).toHaveAttribute("aria-expanded", "true");
  });

  it("cancels the remove confirm without killing or removing", async () => {
    useSessionsStore.setState({
      sessionsByDirectory: {
        "/home/ruben/repo": [{ id: "s1", dirPath: "/home/ruben/repo" }],
      },
    });

    render(<Sidebar />);
    await screen.findByText("repo");

    fireEvent.click(screen.getByRole("button", { name: "Remove repo" }));
    await screen.findByText(/has 1 live session/);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText(/live session/)).not.toBeInTheDocument(),
    );
    expect(mockedCommands.removeDirectory).not.toHaveBeenCalled();
    expect(mockedCommands.killSession).not.toHaveBeenCalled();
  });
});
