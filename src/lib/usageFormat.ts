/**
 * Pure presentation helpers for the usage-meter footer bar.
 *
 * Both functions are side-effect-free and accept an injectable `now` so they
 * can be tested deterministically without faking timers.
 */

/** Utilization percentage at or above which the level is "warn". */
export const WARN_THRESHOLD = 75;

/** Utilization percentage at or above which the level is "crit". */
export const CRIT_THRESHOLD = 90;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Format the time **until** `resetsAt` (an RFC3339 string) as a compact
 * human-readable string relative to `now` (milliseconds, defaults to
 * `Date.now()`).
 *
 * Examples: `"<1m"`, `"12m"`, `"2h13m"`, `"6d"`, `"now"`.
 * A past or near-now timestamp (delta < 1 minute) yields `"now"`.
 */
export function formatCountdown(
  resetsAt: string,
  now: number = Date.now(),
): string {
  const resetMs = new Date(resetsAt).getTime();
  const delta = resetMs - now;

  if (delta < MS_PER_MINUTE) {
    return "now";
  }
  if (delta < MS_PER_HOUR) {
    return `${Math.floor(delta / MS_PER_MINUTE)}m`;
  }
  if (delta < MS_PER_DAY) {
    const hours = Math.floor(delta / MS_PER_HOUR);
    const minutes = Math.floor((delta % MS_PER_HOUR) / MS_PER_MINUTE);
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  }
  return `${Math.floor(delta / MS_PER_DAY)}d`;
}

/**
 * Map a utilization percentage (0–100) to a semantic color level.
 *
 * Boundaries are **inclusive**: `crit` ≥ 90, `warn` ≥ 75, otherwise `ok`.
 */
export function usageLevel(utilization: number): "ok" | "warn" | "crit" {
  if (utilization >= CRIT_THRESHOLD) return "crit";
  if (utilization >= WARN_THRESHOLD) return "warn";
  return "ok";
}
