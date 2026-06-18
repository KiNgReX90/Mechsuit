/**
 * TitleBar tests (RTL + Vitest, window IPC mocked).
 *
 * The borderless window has no native chrome, so this bar owns the window
 * controls. Tests pin the spec-named behaviors: the three controls exist, each
 * drives the matching window op, and the middle control reflects/ toggles the
 * maximized state.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as windowIpc from "../../ipc/window";
import { useUiStore } from "../../state/uiStore";

import { TitleBar } from "./TitleBar";

vi.mock("../../ipc/window", () => ({
  minimizeWindow: vi.fn().mockResolvedValue(undefined),
  toggleMaximizeWindow: vi.fn().mockResolvedValue(undefined),
  closeWindow: vi.fn().mockResolvedValue(undefined),
  isWindowMaximized: vi.fn().mockResolvedValue(false),
  onWindowResized: vi.fn().mockResolvedValue(() => {}),
}));

const ipc = vi.mocked(windowIpc);

beforeEach(() => {
  vi.clearAllMocks();
  ipc.minimizeWindow.mockResolvedValue(undefined);
  ipc.toggleMaximizeWindow.mockResolvedValue(undefined);
  ipc.closeWindow.mockResolvedValue(undefined);
  ipc.isWindowMaximized.mockResolvedValue(false);
  ipc.onWindowResized.mockResolvedValue(() => {});
  useUiStore.setState({ settingsOpen: false, graphOpen: false, collectedOpen: false });
});

describe("TitleBar", () => {
  it("renders the three window controls and the app name", () => {
    render(<TitleBar />);
    expect(screen.getByText("Mechsuit")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Minimize" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Maximize" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("minimizes the window from the minimize control", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(ipc.minimizeWindow).toHaveBeenCalledTimes(1);
  });

  it("toggles maximize from the middle control", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    expect(ipc.toggleMaximizeWindow).toHaveBeenCalledTimes(1);
  });

  it("closes the window from the close control", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(ipc.closeWindow).toHaveBeenCalledTimes(1);
  });

  it("labels the middle control Restore when the window starts maximized", async () => {
    ipc.isWindowMaximized.mockResolvedValue(true);
    render(<TitleBar />);
    expect(
      await screen.findByRole("button", { name: "Restore" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Maximize" })).toBeNull();
  });

  it("subscribes to window resizes to keep the control in sync", async () => {
    render(<TitleBar />);
    await waitFor(() => expect(ipc.onWindowResized).toHaveBeenCalledTimes(1));
  });

  it("opens the settings drawer from the settings control in the bar", async () => {
    render(<TitleBar />);
    expect(useUiStore.getState().settingsOpen).toBe(false);

    // Wrap in act + flush so the click's subscribed re-render and the mount's
    // async maximized-state read both settle inside act (pristine output).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });

    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it("toggles the sessions graph from the graph control and reflects aria-expanded", async () => {
    render(<TitleBar />);
    const button = screen.getByRole("button", { name: "Sessions graph" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(useUiStore.getState().graphOpen).toBe(false);

    // Wrap in act + flush so the click's subscribed re-render and the mount's
    // async maximized-state read both settle inside act (pristine output).
    await act(async () => {
      fireEvent.click(button);
    });

    expect(useUiStore.getState().graphOpen).toBe(true);
    expect(
      screen.getByRole("button", { name: "Sessions graph" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("toggles the collected view from the collected control and reflects aria-expanded", async () => {
    render(<TitleBar />);
    const button = screen.getByRole("button", { name: "Collected view" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(useUiStore.getState().collectedOpen).toBe(false);

    // Wrap in act + flush so the click's subscribed re-render and the mount's
    // async maximized-state read both settle inside act (pristine output).
    await act(async () => {
      fireEvent.click(button);
    });

    expect(useUiStore.getState().collectedOpen).toBe(true);
    expect(
      screen.getByRole("button", { name: "Collected view" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
