/**
 * Pure helpers for drag-to-reorder of the sidebar directory list.
 *
 * No DOM, no React — just the array move and the geometry that maps a drag's
 * cursor position to an insertion slot — so the reordering rules are
 * unit-testable. The Sidebar drag hook ({@link useDirectoryDragReorder}) feeds
 * these measured row midpoints; the store applies {@link reorderForDrop}.
 */

/** Immutably move the item at `from` to index `to`. No-op when `from === to`. */
export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The insertion slot (0..n) for a drag at `pointerY`, given each row's vertical
 * midpoint. The slot is the count of row midpoints above the cursor: 0 means
 * "before the first row", n means "after the last". Used both to position the
 * insertion line and to drive {@link reorderForDrop}.
 */
export function computeDropIndex(pointerY: number, midpointsY: number[]): number {
  let slot = 0;
  for (const mid of midpointsY) {
    if (mid < pointerY) slot += 1;
  }
  return slot;
}

/**
 * Apply a drop of the item at index `from` into insertion `slot` (as returned by
 * {@link computeDropIndex}), returning the reordered list. The two slots
 * adjacent to the dragged item ("its own slot" and "just below itself") both
 * mean "stay put", and return the SAME array reference so callers can cheaply
 * skip the persist/update on a no-op drop.
 */
export function reorderForDrop<T>(list: T[], from: number, slot: number): T[] {
  // The slot is measured against the layout that still includes the dragged
  // item, so a slot past `from` shifts down by one once the item is removed.
  const to = slot > from ? slot - 1 : slot;
  if (to === from) return list;
  return arrayMove(list, from, to);
}
