/**
 * Pick the workspace (managed directory) whose contents were most recently
 * modified. Used to choose which workspace to auto-select on startup so the app
 * lands on live panes instead of an empty grid.
 *
 * `lastModified` is Unix epoch **seconds**, or `null` when the backend could
 * not determine it; a null timestamp is treated as older than any real one. An
 * empty list has nothing to select (`null`). Ties and all-null lists resolve to
 * the first matching directory, keeping the choice stable across reloads.
 */
import type { DirectoryInfo } from "../types";

export function mostRecentlyModified(
  directories: DirectoryInfo[],
): DirectoryInfo | null {
  let best: DirectoryInfo | null = null;
  for (const dir of directories) {
    if (best === null) {
      best = dir;
      continue;
    }
    const candidate = dir.lastModified ?? -Infinity;
    const incumbent = best.lastModified ?? -Infinity;
    if (candidate > incumbent) {
      best = dir;
    }
  }
  return best;
}
