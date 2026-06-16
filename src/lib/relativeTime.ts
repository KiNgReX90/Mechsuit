/**
 * Compact relative-time formatting for directory "edited X ago" labels.
 *
 * Input is a Unix epoch in **seconds** (matching the Rust `lastModified`).
 * Output is a short human string: "just now", "Xm ago", "Xh ago", "Xd ago".
 * The threshold helper decides whether a timestamp counts as "stale".
 */

/** Directories not edited within this many days are styled as stale. */
export const STALE_THRESHOLD_DAYS = 7;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Format `epochSeconds` as a compact "edited ago" string relative to `now`
 * (also epoch seconds, defaults to the current time). Future or near-now
 * timestamps render as "just now". `null` yields `null` so callers can omit
 * the label entirely.
 */
export function relativeTime(
  epochSeconds: number | null,
  now: number = Math.floor(Date.now() / 1000),
): string | null {
  if (epochSeconds == null) {
    return null;
  }
  const delta = now - epochSeconds;
  if (delta < SECONDS_PER_MINUTE) {
    return "just now";
  }
  if (delta < SECONDS_PER_HOUR) {
    return `${Math.floor(delta / SECONDS_PER_MINUTE)}m ago`;
  }
  if (delta < SECONDS_PER_DAY) {
    return `${Math.floor(delta / SECONDS_PER_HOUR)}h ago`;
  }
  return `${Math.floor(delta / SECONDS_PER_DAY)}d ago`;
}

/**
 * Whether `epochSeconds` is older than the stale threshold relative to `now`
 * (both epoch seconds). `null` is never stale (no signal to act on).
 */
export function isStale(
  epochSeconds: number | null,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (epochSeconds == null) {
    return false;
  }
  return now - epochSeconds > STALE_THRESHOLD_DAYS * SECONDS_PER_DAY;
}
