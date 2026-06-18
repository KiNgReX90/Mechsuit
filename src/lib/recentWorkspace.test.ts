import { describe, expect, it } from "vitest";

import type { DirectoryInfo } from "../types";

import { mostRecentlyModified } from "./recentWorkspace";

/** Build a DirectoryInfo fixture with a given path + lastModified. */
const dir = (path: string, lastModified: number | null): DirectoryInfo => ({
  path,
  name: path.split("/").pop() ?? path,
  isGitRepo: false,
  branch: null,
  repo: null,
  lastModified,
});

describe("mostRecentlyModified", () => {
  it("returns null for an empty list", () => {
    expect(mostRecentlyModified([])).toBeNull();
  });

  it("returns the only directory when there is one", () => {
    const a = dir("/a", 100);
    expect(mostRecentlyModified([a])).toBe(a);
  });

  it("picks the directory with the greatest lastModified", () => {
    const a = dir("/a", 100);
    const b = dir("/b", 300);
    const c = dir("/c", 200);
    expect(mostRecentlyModified([a, b, c])).toBe(b);
  });

  it("treats a null lastModified as older than any real timestamp", () => {
    const a = dir("/a", null);
    const b = dir("/b", 1);
    expect(mostRecentlyModified([a, b])).toBe(b);
  });

  it("falls back to the first directory when every lastModified is null", () => {
    const a = dir("/a", null);
    const b = dir("/b", null);
    expect(mostRecentlyModified([a, b])).toBe(a);
  });

  it("returns the first of equally-recent directories (stable)", () => {
    const a = dir("/a", 500);
    const b = dir("/b", 500);
    expect(mostRecentlyModified([a, b])).toBe(a);
  });
});
