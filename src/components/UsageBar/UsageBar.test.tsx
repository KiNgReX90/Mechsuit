/**
 * UsageBar tests (RTL + Vitest, ipc layer mocked).
 *
 * The component is a pure function of `useUsageStore`, so the tests seed the
 * store and assert the rendered output (mirroring Sidebar.test.tsx's
 * store-driven approach). The threshold→level math is already unit-tested in
 * usageFormat; here we pin only what the component adds — that both windows
 * render, the integer %, the countdown text, the semantic level hook for a
 * high-utilization window, and the muted unavailable state.
 */
import type { ReactElement } from "react";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../../ipc/commands";
import { formatCountdown, usageColor } from "../../lib/usageFormat";
import { useUsageStore } from "../../state/usageStore";
import type { UsageSnapshot } from "../../types";

import UsageBar from "./UsageBar";

vi.mock("../../ipc/commands");
vi.mock("../../ipc/events", () => ({
  // Resolve to an inert unlisten fn so the mount effect's subscribe is a no-op.
  onUsageUpdated: vi.fn().mockResolvedValue(() => undefined),
}));

const mockedCommands = vi.mocked(commands);

/** Render and flush the mount-time prime promise so no state update escapes act. */
async function renderSettled(ui: ReactElement) {
  await act(async () => {
    render(ui);
  });
}

// A snapshot with a low 5-hour window and a critical weekly window so a single
// render exercises both the "ok" and "crit" level hooks.
const FIVE_HOUR_RESET = "2026-06-16T18:00:00Z";
const SEVEN_DAY_RESET = "2026-06-22T12:00:00Z";

const snapshot: UsageSnapshot = {
  fiveHour: { utilization: 49, resetsAt: FIVE_HOUR_RESET },
  sevenDay: { utilization: 96, resetsAt: SEVEN_DAY_RESET },
};

beforeEach(() => {
  vi.clearAllMocks();
  useUsageStore.setState({ snapshot: null, error: null, lastUpdated: null });
  // Keep the mount-time prime inert; tests drive state via the store directly.
  mockedCommands.getUsage.mockResolvedValue(snapshot);
});

afterEach(() => {
  cleanup();
});

describe("UsageBar", () => {
  it("renders both windows with integer %, countdown, and gradient color", async () => {
    useUsageStore.setState({ snapshot, error: null, lastUpdated: Date.now() });
    // Prime resolves to the same snapshot, so the seeded render is unchanged.
    mockedCommands.getUsage.mockResolvedValue(snapshot);

    await renderSettled(<UsageBar />);

    // Both labels present, weekly on the left and 5-hour on the right.
    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    const labels = Array.from(
      document.querySelectorAll(".usage-bar-window .usage-bar-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["Weekly", "5h"]);

    // Integer percentages.
    expect(screen.getByText("49%")).toBeInTheDocument();
    expect(screen.getByText("96%")).toBeInTheDocument();

    // Countdown text comes from formatCountdown (no hard-coded strings).
    expect(
      screen.getByText(`· resets ${formatCountdown(FIVE_HOUR_RESET)}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`· resets ${formatCountdown(SEVEN_DAY_RESET)}`),
    ).toBeInTheDocument();

    // Each window exposes its position on the green→red gradient as a
    // `--usage-color` custom property derived from its own utilization, so the
    // near-limit weekly window reads redder than the low 5-hour window.
    const lowWindow = screen.getByText("5h").closest(".usage-bar-window");
    const highWindow = screen.getByText("Weekly").closest(".usage-bar-window");
    expect((lowWindow as HTMLElement).style.getPropertyValue("--usage-color")).toBe(
      usageColor(49),
    );
    expect(
      (highWindow as HTMLElement).style.getPropertyValue("--usage-color"),
    ).toBe(usageColor(96));
  });

  it("shows a loading line (not 'unavailable') before the first result", async () => {
    // Never updated yet: no snapshot, no error, no lastUpdated, and the prime is
    // still in flight — this is boot, not a failure.
    useUsageStore.setState({ snapshot: null, error: null, lastUpdated: null });
    mockedCommands.getUsage.mockReturnValue(new Promise(() => {}));

    await renderSettled(<UsageBar />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText("usage unavailable")).not.toBeInTheDocument();
  });

  it("keeps showing the last good snapshot even when an error is set", async () => {
    // A prior good snapshot is retained through a transient error blip.
    useUsageStore.setState({
      snapshot,
      error: "rate limited",
      lastUpdated: Date.now(),
    });
    // Keep the seeded state (don't let the prime overwrite it).
    mockedCommands.getUsage.mockReturnValue(new Promise(() => {}));

    await renderSettled(<UsageBar />);

    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText("49%")).toBeInTheDocument();
    expect(screen.queryByText("usage unavailable")).not.toBeInTheDocument();
  });

  it("renders a muted unavailable line when snapshot is null", async () => {
    useUsageStore.setState({ snapshot: null, error: null, lastUpdated: null });
    // A failing prime is swallowed into the error state — still unavailable.
    mockedCommands.getUsage.mockRejectedValue(new Error("meter offline"));

    await expect(renderSettled(<UsageBar />)).resolves.not.toThrow();
    expect(screen.getByText("usage unavailable")).toBeInTheDocument();
    expect(screen.queryByText("5h")).not.toBeInTheDocument();
  });

  it("renders the unavailable line when an error is set", async () => {
    useUsageStore.setState({
      snapshot: null,
      error: "meter offline",
      lastUpdated: Date.now(),
    });
    mockedCommands.getUsage.mockRejectedValue(new Error("meter offline"));

    await expect(renderSettled(<UsageBar />)).resolves.not.toThrow();
    expect(screen.getByText("usage unavailable")).toBeInTheDocument();
  });
});
