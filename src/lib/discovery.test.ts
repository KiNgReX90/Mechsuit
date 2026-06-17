import { describe, expect, it } from "vitest";

import type { DiscoveredDir } from "../types";
import { selectableCandidates } from "./discovery";

const dir = (
  name: string,
  overrides: Partial<DiscoveredDir> = {},
): DiscoveredDir => ({
  path: `/home/ruben/dev/${name}`,
  name,
  isGitRepo: false,
  branch: null,
  lastModified: null,
  alreadyManaged: false,
  ...overrides,
});

describe("selectableCandidates", () => {
  it("drops already-managed candidates regardless of query", () => {
    const candidates = [
      dir("alpha"),
      dir("beta", { alreadyManaged: true }),
      dir("gamma"),
    ];

    const result = selectableCandidates(candidates, "");

    expect(result.map((c) => c.name)).toEqual(["alpha", "gamma"]);
  });

  it("keeps all unmanaged candidates for an empty query", () => {
    const candidates = [dir("alpha"), dir("beta")];
    expect(selectableCandidates(candidates, "")).toHaveLength(2);
  });

  it("treats a whitespace-only query as empty", () => {
    const candidates = [dir("alpha"), dir("beta")];
    expect(selectableCandidates(candidates, "   ")).toHaveLength(2);
  });

  it("filters by name, case-insensitively", () => {
    const candidates = [dir("Alpha"), dir("beta")];
    const result = selectableCandidates(candidates, "alph");
    expect(result.map((c) => c.name)).toEqual(["Alpha"]);
  });

  it("filters by path substring", () => {
    const candidates = [
      dir("alpha", { path: "/home/ruben/dev/alpha" }),
      dir("beta", { path: "/srv/work/beta" }),
    ];
    const result = selectableCandidates(candidates, "/srv/");
    expect(result.map((c) => c.name)).toEqual(["beta"]);
  });

  it("never includes an already-managed candidate even if it matches the query", () => {
    const candidates = [dir("alpha", { alreadyManaged: true }), dir("alpine")];
    const result = selectableCandidates(candidates, "alp");
    expect(result.map((c) => c.name)).toEqual(["alpine"]);
  });
});
