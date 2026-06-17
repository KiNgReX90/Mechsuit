/**
 * Unit tests for usageFormat helpers (formatCountdown + usageLevel).
 */
import { describe, expect, it } from "vitest";

import { formatCountdown, usageColor } from "./usageFormat";

// Fixed reference: 2024-01-15T12:00:00.000Z in ms
const NOW = 1_705_320_000_000;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Build an RFC3339 string for NOW + offsetMs */
function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe("formatCountdown", () => {
  it('returns "now" for a past timestamp', () => {
    expect(formatCountdown(at(-HOUR), NOW)).toBe("now");
  });

  it('returns "now" for a timestamp equal to now', () => {
    expect(formatCountdown(at(0), NOW)).toBe("now");
  });

  it('returns "now" when under 1 minute remains', () => {
    expect(formatCountdown(at(MIN - 1), NOW)).toBe("now");
    expect(formatCountdown(at(1), NOW)).toBe("now");
  });

  it('returns "<Xm>" exactly at 1 minute boundary', () => {
    expect(formatCountdown(at(MIN), NOW)).toBe("1m");
  });

  it("returns minutes for ranges in [1m, 1h)", () => {
    expect(formatCountdown(at(MIN), NOW)).toBe("1m");
    expect(formatCountdown(at(12 * MIN), NOW)).toBe("12m");
    expect(formatCountdown(at(59 * MIN), NOW)).toBe("59m");
    // 1 ms before 1h still in minute range
    expect(formatCountdown(at(HOUR - 1), NOW)).toBe("59m");
  });

  it("returns hours-only when minutes remainder is zero", () => {
    expect(formatCountdown(at(HOUR), NOW)).toBe("1h");
    expect(formatCountdown(at(2 * HOUR), NOW)).toBe("2h");
  });

  it("returns hours+minutes for sub-day ranges with remainder", () => {
    expect(formatCountdown(at(2 * HOUR + 13 * MIN), NOW)).toBe("2h13m");
    expect(formatCountdown(at(23 * HOUR + 59 * MIN), NOW)).toBe("23h59m");
  });

  it("returns days at 1-day boundary", () => {
    expect(formatCountdown(at(DAY), NOW)).toBe("1d");
  });

  it("returns day count for multi-day ranges", () => {
    expect(formatCountdown(at(6 * DAY), NOW)).toBe("6d");
    expect(formatCountdown(at(7 * DAY), NOW)).toBe("7d");
  });

  it("uses Date.now() by default (smoke test: result is a string)", () => {
    // Just verify it doesn't throw and returns a string for a future reset
    const result = formatCountdown(new Date(Date.now() + HOUR).toISOString());
    expect(typeof result).toBe("string");
  });
});

describe("usageColor", () => {
  // The anchor points define the gradient the spec names: a continuous sweep
  // green → yellow → orange → red as utilization climbs 0 → 100.
  it("is green at 0% utilization", () => {
    expect(usageColor(0)).toBe("hsl(120, 72%, 50%)");
  });

  it("is yellow at the midpoint", () => {
    expect(usageColor(50)).toBe("hsl(60, 72%, 50%)");
  });

  it("is orange around three-quarters", () => {
    expect(usageColor(75)).toBe("hsl(30, 72%, 50%)");
  });

  it("is red at 100% utilization", () => {
    expect(usageColor(100)).toBe("hsl(0, 72%, 50%)");
  });

  it("clamps out-of-range values to the green/red endpoints", () => {
    expect(usageColor(-20)).toBe(usageColor(0));
    expect(usageColor(140)).toBe(usageColor(100));
  });

  // "the more the percentage increases ... the more towards red": hue must fall
  // monotonically (120° green → 0° red) across the whole range.
  it("shifts strictly toward red as utilization rises", () => {
    const hue = (u: number) => Number(/hsl\((\d+)/.exec(usageColor(u))![1]);
    for (let u = 0; u < 100; u += 5) {
      expect(hue(u + 5)).toBeLessThan(hue(u));
    }
    expect(hue(0)).toBe(120);
    expect(hue(100)).toBe(0);
  });
});
