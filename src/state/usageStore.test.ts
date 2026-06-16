import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UsageSnapshot } from "../types";
import { useUsageStore } from "./usageStore";

const initialState = useUsageStore.getState();

const mockSnapshot: UsageSnapshot = {
  fiveHour: { utilization: 42, resetsAt: "2024-01-15T17:00:00Z" },
  sevenDay: { utilization: 10, resetsAt: "2024-01-22T12:00:00Z" },
};

describe("usageStore", () => {
  beforeEach(() => {
    useUsageStore.setState(initialState, true);
  });

  it("starts with null snapshot, null error, and null lastUpdated", () => {
    const state = useUsageStore.getState();
    expect(state.snapshot).toBeNull();
    expect(state.error).toBeNull();
    expect(state.lastUpdated).toBeNull();
  });

  describe("applyUpdate — success shape", () => {
    it("sets snapshot and clears error on a successful update", () => {
      useUsageStore.getState().applyUpdate({ snapshot: mockSnapshot, error: null });
      const state = useUsageStore.getState();
      expect(state.snapshot).toEqual(mockSnapshot);
      expect(state.error).toBeNull();
    });

    it("stamps lastUpdated with current time on a successful update", () => {
      const fakeNow = 1_705_320_000_000;
      vi.spyOn(Date, "now").mockReturnValue(fakeNow);
      useUsageStore.getState().applyUpdate({ snapshot: mockSnapshot, error: null });
      expect(useUsageStore.getState().lastUpdated).toBe(fakeNow);
      vi.restoreAllMocks();
    });

    it("clears a prior error when a success update arrives", () => {
      // First set an error state
      useUsageStore.getState().applyUpdate({ snapshot: null, error: "network timeout" });
      expect(useUsageStore.getState().error).toBe("network timeout");

      // Success clears the error
      useUsageStore.getState().applyUpdate({ snapshot: mockSnapshot, error: null });
      expect(useUsageStore.getState().error).toBeNull();
      expect(useUsageStore.getState().snapshot).toEqual(mockSnapshot);
    });
  });

  describe("applyUpdate — failure shape", () => {
    it("sets error and clears snapshot on a failure update", () => {
      // First get a snapshot in place
      useUsageStore.getState().applyUpdate({ snapshot: mockSnapshot, error: null });
      expect(useUsageStore.getState().snapshot).toEqual(mockSnapshot);

      // Now a failure
      useUsageStore.getState().applyUpdate({ snapshot: null, error: "rate limited" });
      const state = useUsageStore.getState();
      expect(state.snapshot).toBeNull();
      expect(state.error).toBe("rate limited");
    });

    it("stamps lastUpdated on a failure update", () => {
      const fakeNow = 1_705_400_000_000;
      vi.spyOn(Date, "now").mockReturnValue(fakeNow);
      useUsageStore.getState().applyUpdate({ snapshot: null, error: "API down" });
      expect(useUsageStore.getState().lastUpdated).toBe(fakeNow);
      vi.restoreAllMocks();
    });

    it("successive failures overwrite the error message", () => {
      useUsageStore.getState().applyUpdate({ snapshot: null, error: "first error" });
      useUsageStore.getState().applyUpdate({ snapshot: null, error: "second error" });
      expect(useUsageStore.getState().error).toBe("second error");
    });
  });
});
