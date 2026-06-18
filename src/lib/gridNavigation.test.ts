import { describe, it, expect } from "vitest";
import { gridNeighbor, linearNeighbor } from "./gridNavigation";
import type { SessionInfo } from "../types";

// Build n sessions s0..s(n-1) in order. The grid lays them out via
// computeGridLayout, so for n=5 the geometry is:
//   row0: [s0, s1, s2]
//   row1: [s3, s4]
const make = (n: number): SessionInfo[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, dirPath: "/d" }));

describe("gridNeighbor (2D spatial, clamp at edges)", () => {
  const five = make(5); // rows [3, 2]

  it("moves left within a row", () => {
    expect(gridNeighbor(five, "s2", "left")).toBe("s1");
  });

  it("moves right within a row", () => {
    expect(gridNeighbor(five, "s0", "right")).toBe("s1");
  });

  it("moves down to the row below, snapping to the nearest column", () => {
    // s1 is row0 col1; the bottom row has cols 0..1, so col1 -> s4.
    expect(gridNeighbor(five, "s1", "down")).toBe("s4");
  });

  it("moves up to the row above", () => {
    // s3 is row1 col0; up -> row0 col0 -> s0.
    expect(gridNeighbor(five, "s3", "up")).toBe("s0");
  });

  it("snaps to the nearest column when the target row is narrower (down)", () => {
    // s2 is row0 col2; the bottom row only has cols 0..1, so it snaps to col1 -> s4.
    expect(gridNeighbor(five, "s2", "down")).toBe("s4");
  });

  it("clamps at the right edge (stays put)", () => {
    expect(gridNeighbor(five, "s2", "right")).toBe("s2");
  });

  it("clamps at the left edge (stays put)", () => {
    expect(gridNeighbor(five, "s0", "left")).toBe("s0");
  });

  it("clamps at the top edge (stays put)", () => {
    expect(gridNeighbor(five, "s0", "up")).toBe("s0");
  });

  it("clamps at the bottom edge (stays put)", () => {
    expect(gridNeighbor(five, "s3", "down")).toBe("s3");
    expect(gridNeighbor(five, "s4", "down")).toBe("s4");
  });

  it("falls back to the first session when focus is null", () => {
    expect(gridNeighbor(five, null, "right")).toBe("s0");
  });

  it("falls back to the first session when focus is unknown", () => {
    expect(gridNeighbor(five, "ghost", "left")).toBe("s0");
  });

  it("returns null when there are no sessions", () => {
    expect(gridNeighbor([], null, "right")).toBeNull();
  });
});

describe("linearNeighbor (next/prev, clamp at ends)", () => {
  const three = make(3);

  it("right and down advance to the next session", () => {
    expect(linearNeighbor(three, "s0", "right")).toBe("s1");
    expect(linearNeighbor(three, "s0", "down")).toBe("s1");
  });

  it("left and up retreat to the previous session", () => {
    expect(linearNeighbor(three, "s1", "left")).toBe("s0");
    expect(linearNeighbor(three, "s1", "up")).toBe("s0");
  });

  it("clamps at the last session", () => {
    expect(linearNeighbor(three, "s2", "right")).toBe("s2");
  });

  it("clamps at the first session", () => {
    expect(linearNeighbor(three, "s0", "left")).toBe("s0");
  });

  it("falls back to the first session when current is null or unknown", () => {
    expect(linearNeighbor(three, null, "right")).toBe("s0");
    expect(linearNeighbor(three, "ghost", "left")).toBe("s0");
  });

  it("returns null when there are no sessions", () => {
    expect(linearNeighbor([], null, "right")).toBeNull();
  });
});
