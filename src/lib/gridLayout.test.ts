import { describe, it, expect } from 'vitest';
import { computeGridLayout } from './gridLayout';

describe('computeGridLayout', () => {
  describe('edge cases: n <= 0', () => {
    it('returns empty rows for n = 0', () => {
      expect(computeGridLayout(0)).toEqual({ rows: [] });
    });

    it('returns empty rows for negative n', () => {
      expect(computeGridLayout(-1)).toEqual({ rows: [] });
      expect(computeGridLayout(-5)).toEqual({ rows: [] });
    });
  });

  describe('verified examples from spec', () => {
    it('n = 1 -> [1]', () => {
      expect(computeGridLayout(1)).toEqual({ rows: [1] });
    });

    it('n = 2 -> [2] (two panes side by side, not stacked)', () => {
      expect(computeGridLayout(2)).toEqual({ rows: [2] });
    });

    it('n = 3 -> [2, 1]', () => {
      expect(computeGridLayout(3)).toEqual({ rows: [2, 1] });
    });

    it('n = 4 -> [2, 2]', () => {
      expect(computeGridLayout(4)).toEqual({ rows: [2, 2] });
    });

    it('n = 5 -> [3, 2]', () => {
      expect(computeGridLayout(5)).toEqual({ rows: [3, 2] });
    });

    it('n = 6 -> [3, 3]', () => {
      expect(computeGridLayout(6)).toEqual({ rows: [3, 3] });
    });

    it('n = 7 -> [4, 3]', () => {
      expect(computeGridLayout(7)).toEqual({ rows: [4, 3] });
    });

    it('n = 9 -> [5, 4]', () => {
      expect(computeGridLayout(9)).toEqual({ rows: [5, 4] });
    });
  });

  describe('invariants', () => {
    // n = 2 is special-cased to a single side-by-side row; the two-row grid
    // begins at n = 3.
    const twoRowCases = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20];

    it('rows sum to n (including the n=2 single row)', () => {
      for (const n of [2, ...twoRowCases]) {
        const { rows } = computeGridLayout(n);
        const sum = rows.reduce((a, b) => a + b, 0);
        expect(sum, `sum for n=${n}`).toBe(n);
      }
    });

    it('top row >= bottom row for n >= 3', () => {
      for (const n of twoRowCases) {
        const { rows } = computeGridLayout(n);
        expect(rows[0], `top row for n=${n}`).toBeGreaterThanOrEqual(rows[1]);
      }
    });

    it('exactly two rows for n >= 3', () => {
      for (const n of twoRowCases) {
        const { rows } = computeGridLayout(n);
        expect(rows.length, `row count for n=${n}`).toBe(2);
      }
    });
  });
});
