/**
 * Keyboard focus navigation across the tiled session grid.
 *
 * Pure geometry — no DOM, no React — so the spatial rules are unit-testable.
 * `gridNeighbor` honors the same row layout the workspace renders (via
 * {@link computeGridLayout}); `linearNeighbor` is the flat next/prev used when
 * one pane is expanded full-screen. Both clamp at the edges (no wrap) and fall
 * back to the first session when nothing is focused yet, so the first key press
 * always lands somewhere.
 */
import type { SessionInfo } from "../types";
import { computeGridLayout } from "./gridLayout";

export type NavDirection = "up" | "down" | "left" | "right";

/** Slice sessions into the rows the grid renders, in reading order. */
function toRows(sessions: SessionInfo[]): SessionInfo[][] {
  const { rows } = computeGridLayout(sessions.length);
  let cursor = 0;
  return rows.map((count) => {
    const slice = sessions.slice(cursor, cursor + count);
    cursor += count;
    return slice;
  });
}

/**
 * Id of the session in `direction` from the focused one within the 2D grid,
 * clamping at edges. Up/Down snap to the nearest column when the target row is
 * narrower. Falls back to the first session when `focusedId` is null/unknown;
 * returns null only when there are no sessions.
 */
export function gridNeighbor(
  sessions: SessionInfo[],
  focusedId: string | null,
  direction: NavDirection,
): string | null {
  if (sessions.length === 0) return null;

  const grid = toRows(sessions);
  // Locate the focused session's row/col; default to the top-left on a miss.
  let row = -1;
  let col = -1;
  for (let r = 0; r < grid.length; r += 1) {
    const c = grid[r].findIndex((s) => s.id === focusedId);
    if (c !== -1) {
      row = r;
      col = c;
      break;
    }
  }
  if (row === -1) return sessions[0].id;

  switch (direction) {
    case "left":
      col = Math.max(0, col - 1);
      break;
    case "right":
      col = Math.min(grid[row].length - 1, col + 1);
      break;
    case "up":
    case "down": {
      const targetRow = direction === "up" ? row - 1 : row + 1;
      if (targetRow < 0 || targetRow >= grid.length) break; // clamp: stay put
      row = targetRow;
      // Snap to the nearest column when the target row is narrower.
      col = Math.min(col, grid[row].length - 1);
      break;
    }
  }

  return grid[row][col].id;
}

/**
 * Flat next/prev neighbor (Right/Down = next, Left/Up = previous), clamped at
 * the ends. Used while one pane is expanded. Falls back to the first session
 * when `currentId` is null/unknown; returns null only when there are no sessions.
 */
export function linearNeighbor(
  sessions: SessionInfo[],
  currentId: string | null,
  direction: NavDirection,
): string | null {
  if (sessions.length === 0) return null;

  const index = sessions.findIndex((s) => s.id === currentId);
  if (index === -1) return sessions[0].id;

  const step = direction === "right" || direction === "down" ? 1 : -1;
  const next = Math.min(sessions.length - 1, Math.max(0, index + step));
  return sessions[next].id;
}
