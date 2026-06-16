/**
 * Unit tests for usageFormat helpers (formatCountdown + usageLevel).
 */
import { describe, expect, it } from "vitest";

import {
  CRIT_THRESHOLD,
  WARN_THRESHOLD,
  formatCountdown,
  usageLevel,
} from "./usageFormat";

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

describe("usageLevel", () => {
  it('returns "ok" below warn threshold', () => {
    expect(usageLevel(0)).toBe("ok");
    expect(usageLevel(74)).toBe("ok");
    expect(usageLevel(WARN_THRESHOLD - 1)).toBe("ok");
  });

  it('returns "warn" at the warn threshold boundary (inclusive)', () => {
    expect(usageLevel(WARN_THRESHOLD)).toBe("warn");
  });

  it('returns "warn" between warn and crit thresholds', () => {
    expect(usageLevel(75)).toBe("warn");
    expect(usageLevel(89)).toBe("warn");
    expect(usageLevel(CRIT_THRESHOLD - 1)).toBe("warn");
  });

  it('returns "crit" at the crit threshold boundary (inclusive)', () => {
    expect(usageLevel(CRIT_THRESHOLD)).toBe("crit");
  });

  it('returns "crit" above the crit threshold', () => {
    expect(usageLevel(91)).toBe("crit");
    expect(usageLevel(100)).toBe("crit");
  });
});
