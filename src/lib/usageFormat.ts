/**
 * Pure presentation helpers for the usage-meter footer bar.
 *
 * Both functions are side-effect-free and accept an injectable `now` so they
 * can be tested deterministically without faking timers.
 */

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
 * Map a utilization percentage to a point on a continuous green→red gradient.
 *
 * The hue sweeps linearly from 120° (green) at 0% down to 0° (red) at 100%,
 * passing through yellow (~60°) and orange (~30°) on the way, so the color
 * shifts further toward red the closer a window is to its limit. The input is
 * clamped to 0–100 first. Returns an `hsl(...)` string for use as a CSS value.
 */
export function usageColor(utilization: number): string {
  const clamped = Math.max(0, Math.min(100, utilization));
  const hue = Math.round(120 - 1.2 * clamped);
  return `hsl(${hue}, 72%, 50%)`;
}
