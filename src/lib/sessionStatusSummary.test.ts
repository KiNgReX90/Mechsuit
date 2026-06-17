import { describe, it, expect } from "vitest";

import { summarizeSessionStatuses } from "./sessionStatusSummary";

describe("summarizeSessionStatuses", () => {
  it("returns no badges for a workspace with no sessions", () => {
    expect(summarizeSessionStatuses([])).toEqual([]);
  });

  it("returns no badges when every session is working or untracked", () => {
    expect(
      summarizeSessionStatuses(["working", "working", undefined]),
    ).toEqual([]);
  });

  it("counts ready sessions into a single green badge", () => {
    expect(summarizeSessionStatuses(["ready", "ready", "working"])).toEqual([
      { status: "ready", count: 2 },
    ]);
  });

  it("emits one badge per non-empty status, ready→awaiting→error", () => {
    // Four sessions: two ready, one awaiting approval, one error.
    expect(
      summarizeSessionStatuses([
        "error",
        "ready",
        "awaiting-approval",
        "ready",
      ]),
    ).toEqual([
      { status: "ready", count: 2 },
      { status: "awaiting-approval", count: 1 },
      { status: "error", count: 1 },
    ]);
  });

  it("omits a status with zero sessions from the badge list", () => {
    expect(
      summarizeSessionStatuses(["awaiting-approval", "error", "error"]),
    ).toEqual([
      { status: "awaiting-approval", count: 1 },
      { status: "error", count: 2 },
    ]);
  });
});
