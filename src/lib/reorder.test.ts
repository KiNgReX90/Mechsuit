import { describe, it, expect } from "vitest";
import { arrayMove, computeDropIndex, reorderForDrop } from "./reorder";

describe("arrayMove", () => {
  it("moves an item down", () => {
    expect(arrayMove(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item up", () => {
    expect(arrayMove(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when from === to", () => {
    expect(arrayMove(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"];
    arrayMove(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });
});

describe("computeDropIndex (insertion slot 0..n from cursor Y)", () => {
  // Three rows with midpoints at y = 10, 30, 50.
  const mids = [10, 30, 50];

  it("returns 0 when the cursor is above every row", () => {
    expect(computeDropIndex(5, mids)).toBe(0);
  });

  it("returns n when the cursor is below every row", () => {
    expect(computeDropIndex(100, mids)).toBe(3);
  });

  it("counts the row midpoints above the cursor", () => {
    expect(computeDropIndex(20, mids)).toBe(1); // past row0's midpoint
    expect(computeDropIndex(40, mids)).toBe(2); // past row0 and row1
  });

  it("returns 0 for an empty list", () => {
    expect(computeDropIndex(123, [])).toBe(0);
  });
});

describe("reorderForDrop (slot -> moved list, adjacent slots are no-ops)", () => {
  const list = ["a", "b", "c", "d"];

  it("drops a top item into a lower slot", () => {
    // dragging `a` (index 0) into slot 2 (between b and c) -> [b, a, c, d]
    expect(reorderForDrop(list, 0, 2)).toEqual(["b", "a", "c", "d"]);
  });

  it("drops a top item to the very end", () => {
    expect(reorderForDrop(list, 0, 4)).toEqual(["b", "c", "d", "a"]);
  });

  it("drops a bottom item upward", () => {
    // dragging `d` (index 3) into slot 1 (between a and b) -> [a, d, b, c]
    expect(reorderForDrop(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the same array when dropped in its own slot", () => {
    expect(reorderForDrop(list, 1, 1)).toBe(list);
  });

  it("returns the same array when dropped just below itself", () => {
    expect(reorderForDrop(list, 1, 2)).toBe(list);
  });
});
