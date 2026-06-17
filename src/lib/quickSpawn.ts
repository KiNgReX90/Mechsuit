/**
 * Quick-spawn layouts for the workspace action bar.
 *
 * Alongside the single "add terminal" button, the bar offers one-click targets
 * that fill the workspace to a fixed terminal count. A target is offered only
 * while the workspace has fewer terminals than it (you can't "reach 4" once you
 * already have 4+), and clicking it spawns just enough new terminals to land on
 * that total.
 */

/** The quick-layout terminal counts, ascending. */
export const QUICK_SPAWN_COUNTS = [2, 4, 6, 8] as const;

/**
 * The quick-spawn targets still reachable from `currentCount` — those strictly
 * greater than the number of terminals already open. Returns an empty list once
 * the largest target has been reached or exceeded.
 */
export function quickSpawnTargets(currentCount: number): number[] {
  return QUICK_SPAWN_COUNTS.filter((n) => n > currentCount);
}

/**
 * How many new terminals to spawn to reach `target` from `currentCount`. Never
 * negative: already at or above the target spawns nothing.
 */
export function spawnsToReach(currentCount: number, target: number): number {
  return Math.max(0, target - currentCount);
}
