/**
 * sessionName unit tests (Vitest).
 *
 * generateSessionName picks a single-word codename not already taken. The rng
 * is injectable so picks are deterministic in tests; production calls fall back
 * to Math.random.
 */
import { describe, expect, it } from "vitest";

import { SESSION_CODENAMES, generateSessionName } from "./sessionName";

describe("generateSessionName", () => {
  it("returns a codename from the curated list when none are taken", () => {
    const name = generateSessionName([], () => 0);
    expect(SESSION_CODENAMES).toContain(name);
    expect(name).toBe(SESSION_CODENAMES[0]);
  });

  it("never returns a name that is already taken", () => {
    // rng=0 would otherwise pick index 0; with it taken, the first FREE name wins.
    const name = generateSessionName([SESSION_CODENAMES[0]], () => 0);
    expect(name).toBe(SESSION_CODENAMES[1]);
  });

  it("picks across the list as the rng varies", () => {
    const last = generateSessionName([], () => 0.999999);
    expect(last).toBe(SESSION_CODENAMES[SESSION_CODENAMES.length - 1]);
  });

  it("falls back to a unique numeric suffix once every base name is taken", () => {
    const name = generateSessionName([...SESSION_CODENAMES], () => 0);
    expect(name).toBe(`${SESSION_CODENAMES[0]}-2`);
  });

  it("keeps suffixing until it finds a free name", () => {
    const taken = [
      ...SESSION_CODENAMES,
      ...SESSION_CODENAMES.map((n) => `${n}-2`),
    ];
    const name = generateSessionName(taken, () => 0);
    expect(name).toBe(`${SESSION_CODENAMES[0]}-3`);
  });

  it("exposes a non-trivial pool of distinct codenames", () => {
    expect(new Set(SESSION_CODENAMES).size).toBe(SESSION_CODENAMES.length);
    expect(SESSION_CODENAMES.length).toBeGreaterThanOrEqual(32);
  });
});
