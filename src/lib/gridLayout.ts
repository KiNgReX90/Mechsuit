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
  return { rows: [Math.ceil(n / 2), Math.floor(n / 2)] };
}
