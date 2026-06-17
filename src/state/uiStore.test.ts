import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "./uiStore";

// Mock the Tauri IPC layer so the command wrapper can be exercised without a
// running backend.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { addDirectory } from "../ipc/commands";
import type { DirectoryInfo } from "../types";

const initialUiState = useUiStore.getState();

describe("uiStore", () => {
  beforeEach(() => {
    useUiStore.setState(initialUiState, true);
  });

  it("starts with all selection state cleared", () => {
    const state = useUiStore.getState();
    expect(state.selectedDirectoryPath).toBeNull();
    expect(state.focusedSessionId).toBeNull();
    expect(state.expandedSessionId).toBeNull();
  });

  it("starts with the Commander overlay closed (boot default)", () => {
    expect(useUiStore.getState().commanderOpen).toBe(false);
  });

  it("starts with the Settings drawer closed", () => {
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("opens, closes, and toggles the Settings drawer", () => {
    useUiStore.getState().setSettingsOpen(true);
    expect(useUiStore.getState().settingsOpen).toBe(true);

    useUiStore.getState().setSettingsOpen(false);
    expect(useUiStore.getState().settingsOpen).toBe(false);

    useUiStore.getState().toggleSettings();
    expect(useUiStore.getState().settingsOpen).toBe(true);
    useUiStore.getState().toggleSettings();
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("sets and clears the selected directory path", () => {
    useUiStore.getState().setSelectedDirectoryPath("/home/dev/repo");
    expect(useUiStore.getState().selectedDirectoryPath).toBe("/home/dev/repo");

    useUiStore.getState().setSelectedDirectoryPath(null);
    expect(useUiStore.getState().selectedDirectoryPath).toBeNull();
  });

  it("sets the focused session id", () => {
    useUiStore.getState().setFocusedSessionId("session-1");
    expect(useUiStore.getState().focusedSessionId).toBe("session-1");
  });

  it("sets the expanded session id", () => {
    useUiStore.getState().setExpandedSessionId("session-2");
    expect(useUiStore.getState().expandedSessionId).toBe("session-2");
  });
});

describe("ipc command wrapper", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("addDirectory invokes the backend command with the path arg", async () => {
    const info: DirectoryInfo = {
      path: "/home/dev/repo",
      name: "repo",
      isGitRepo: true,
      branch: "main",
      lastModified: null,
    };
    invokeMock.mockResolvedValueOnce(info);

    const result = await addDirectory("/home/dev/repo");

    expect(invokeMock).toHaveBeenCalledWith("add_directory", {
      path: "/home/dev/repo",
    });
    expect(result).toEqual(info);
  });
});
