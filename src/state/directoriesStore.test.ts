/**
 * directoriesStore unit tests (Vitest, ipc layer mocked).
 *
 * Covers `reorder`: optimistically moves the dragged directory into its drop
 * slot, persists the resulting path order via `reorderDirectories`, is a no-op
 * for a drop that does not change order, and resyncs from disk (`load`) when
 * persistence rejects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../ipc/commands";
import { useDirectoriesStore } from "./directoriesStore";
import type { DirectoryInfo } from "../types";

vi.mock("../ipc/commands");

const mockedCommands = vi.mocked(commands);

const dir = (path: string): DirectoryInfo => ({
  path,
  name: path,
  isGitRepo: false,
  branch: null,
  repo: null,
  lastModified: null,
});

const A = dir("/a");
const B = dir("/b");
const C = dir("/c");

const paths = () =>
  useDirectoriesStore.getState().directories.map((d) => d.path);

beforeEach(() => {
  vi.clearAllMocks();
  useDirectoriesStore.setState({ directories: [A, B, C] });
  mockedCommands.reorderDirectories.mockResolvedValue(undefined);
  mockedCommands.listDirectories.mockResolvedValue([A, B, C]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("directoriesStore.reorder", () => {
  it("moves the dragged directory into its drop slot", async () => {
    // Drag `/a` (index 0) into slot 2 (between /b and /c) -> [/b, /a, /c].
    await useDirectoriesStore.getState().reorder(0, 2);

    expect(paths()).toEqual(["/b", "/a", "/c"]);
  });

  it("persists the resulting path order", async () => {
    await useDirectoriesStore.getState().reorder(2, 0); // /c to the top

    expect(mockedCommands.reorderDirectories).toHaveBeenCalledWith([
      "/c",
      "/a",
      "/b",
    ]);
  });

  it("is a no-op when the drop does not change order", async () => {
    // Dropping index 1 into slot 1 (its own slot) changes nothing.
    await useDirectoriesStore.getState().reorder(1, 1);

    expect(paths()).toEqual(["/a", "/b", "/c"]);
    expect(mockedCommands.reorderDirectories).not.toHaveBeenCalled();
  });

  it("resyncs from disk when persistence rejects", async () => {
    mockedCommands.reorderDirectories.mockRejectedValueOnce(new Error("disk"));

    await useDirectoriesStore.getState().reorder(0, 2);

    expect(mockedCommands.listDirectories).toHaveBeenCalled();
  });
});
