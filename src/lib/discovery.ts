/**
 * Pure selection logic for the add-workspace combobox.
 *
 * Discovery returns every candidate under the workspace root, including ones
 * already in the managed list (flagged `alreadyManaged`). The combobox should
 * only ever offer directories you can actually add, so already-managed
 * candidates are dropped outright; the remainder is filtered by a
 * case-insensitive substring match over name or path. Kept framework-free so it
 * is unit-tested exhaustively, independent of the React component that renders
 * the result.
 */
import type { DiscoveredDir } from "../types";

export function selectableCandidates(
  candidates: DiscoveredDir[],
  query: string,
): DiscoveredDir[] {
  const unmanaged = candidates.filter((c) => !c.alreadyManaged);
  const q = query.trim().toLowerCase();
  if (!q) {
    return unmanaged;
  }
  return unmanaged.filter(
    (c) =>
      c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q),
  );
}
