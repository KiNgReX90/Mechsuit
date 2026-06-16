/**
 * Unit tests for the relativeTime util (boundary formatting + staleness).
 */
import { describe, expect, it } from "vitest";

import { isStale, relativeTime, STALE_THRESHOLD_DAYS } from "./relativeTime";

const NOW = 1_700_000_000; // fixed reference epoch seconds
const MINUTE = 60;
const HOUR = 60 * 60;
const DAY = 24 * 60 * 60;

describe("relativeTime", () => {
  it("returns null for a null timestamp", () => {
    expect(relativeTime(null, NOW)).toBeNull();
  });

  it('renders "just now" within the first minute', () => {
    expect(relativeTime(NOW, NOW)).toBe("just now");
    expect(relativeTime(NOW - 59, NOW)).toBe("just now");
  });

  it("renders minutes between 1m and 1h", () => {
    expect(relativeTime(NOW - MINUTE, NOW)).toBe("1m ago");
    expect(relativeTime(NOW - 59 * MINUTE, NOW)).toBe("59m ago");
  });

  it("renders hours between 1h and 1d", () => {
    expect(relativeTime(NOW - HOUR, NOW)).toBe("1h ago");
    expect(relativeTime(NOW - 23 * HOUR, NOW)).toBe("23h ago");
  });

  it("renders days at and beyond 1d", () => {
    expect(relativeTime(NOW - DAY, NOW)).toBe("1d ago");
    expect(relativeTime(NOW - 3 * DAY, NOW)).toBe("3d ago");
  });

  it("treats future timestamps as just now", () => {
    expect(relativeTime(NOW + HOUR, NOW)).toBe("just now");
  });
});

describe("isStale", () => {
  it("is false for null", () => {
    expect(isStale(null, NOW)).toBe(false);
  });

  it("is false at the threshold and true past it", () => {
    expect(isStale(NOW - STALE_THRESHOLD_DAYS * DAY, NOW)).toBe(false);
    expect(isStale(NOW - (STALE_THRESHOLD_DAYS * DAY + 1), NOW)).toBe(true);
  });

  it("is false for a freshly edited directory", () => {
    expect(isStale(NOW - HOUR, NOW)).toBe(false);
  });
});
