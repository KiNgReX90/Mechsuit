/**
 * Per-workspace session status roll-up for the sidebar.
 *
 * Each managed directory shows a small badge per attention-worthy status — a
 * colored circle with the count of its sessions in that state. Working and
 * untracked sessions contribute to no badge (only finished/blocked/broken
 * states are surfaced), so the sidebar stays calm until something needs a look.
 */
import type { SessionStatus } from "../types";

export interface StatusBadge {
  status: SessionStatus;
  count: number;
}

/**
 * The statuses surfaced as sidebar badges, in display order: ready (green) →
 * awaiting-approval (amber) → error (red). `working` is intentionally absent.
 */
const BADGE_ORDER: SessionStatus[] = ["ready", "awaiting-approval", "error"];

/**
 * Roll a directory's per-session statuses up into one badge per non-empty
 * displayed status, in `BADGE_ORDER`. Pass `undefined` for sessions with no
 * tracked status yet; they (and `working` sessions) are counted into nothing.
 */
export function summarizeSessionStatuses(
  statuses: Array<SessionStatus | undefined>,
): StatusBadge[] {
  return BADGE_ORDER.map((status) => ({
    status,
    count: statuses.filter((s) => s === status).length,
  })).filter((badge) => badge.count > 0);
}
