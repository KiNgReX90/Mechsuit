export interface GridLayout {
  rows: number[];
}

export function computeGridLayout(n: number): GridLayout {
  if (n <= 0) {
    return { rows: [] };
  }
  if (n === 1) {
    return { rows: [1] };
  }
  // Two panes sit side by side in a single row (one row of two tiles), rather
  // than stacked one above the other. Three or more fall back to the
  // top-row-heavy two-row grid.
  if (n === 2) {
    return { rows: [2] };
  }
  return { rows: [Math.ceil(n / 2), Math.floor(n / 2)] };
}
