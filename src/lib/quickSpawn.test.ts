import { describe, it, expect } from "vitest";

import {
  QUICK_SPAWN_COUNTS,
  quickSpawnTargets,
  spawnsToReach,
} from "./quickSpawn";

describe("QUICK_SPAWN_COUNTS", () => {
  it("offers the 2/4/6/8 quick layouts in ascending order", () => {
    expect(QUICK_SPAWN_COUNTS).toEqual([2, 4, 6, 8]);
  });
});

describe("quickSpawnTargets", () => {
  it("offers every target when no terminals are open yet", () => {
    expect(quickSpawnTargets(0)).toEqual([2, 4, 6, 8]);
  });

  it("offers every target above the single default terminal", () => {
    expect(quickSpawnTargets(1)).toEqual([2, 4, 6, 8]);
  });

  it("drops a target once that count has been reached", () => {
    expect(quickSpawnTargets(2)).toEqual([4, 6, 8]);
    expect(quickSpawnTargets(4)).toEqual([6, 8]);
  });

  it("keeps only the targets still strictly above the current count", () => {
    expect(quickSpawnTargets(7)).toEqual([8]);
  });

  it("offers nothing once the largest target is reached or exceeded", () => {
    expect(quickSpawnTargets(8)).toEqual([]);
    expect(quickSpawnTargets(12)).toEqual([]);
  });
});

describe("spawnsToReach", () => {
  it("returns how many new terminals reach the target from the current count", () => {
    expect(spawnsToReach(1, 4)).toBe(3);
    expect(spawnsToReach(0, 8)).toBe(8);
    expect(spawnsToReach(2, 2)).toBe(0);
  });

  it("never returns a negative count when already at or above the target", () => {
    expect(spawnsToReach(5, 4)).toBe(0);
  });
});
