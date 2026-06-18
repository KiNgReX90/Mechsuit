import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// --- ipc mock --------------------------------------------------------------
// Clear/Compact call writeSession directly; mock it so we can assert the
// exact command + session id without touching the real Tauri bridge.
vi.mock("../../ipc/commands", () => ({
  writeSession: vi.fn(() => Promise.resolve()),
}));

import { writeSession } from "../../ipc/commands";
import { SessionActions } from "./SessionActions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderActions(overrides: Partial<{
  sessionId: string;
  isExpanded: boolean;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
  onClose: (id: string) => void;
  showExpand: boolean;
}> = {}) {
  const props = {
    sessionId: "s1",
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SessionActions {...props} />);
  return props;
}

describe("<SessionActions />", () => {
  it("renders four icon buttons with accessible labels", () => {
    renderActions();
    expect(
      screen.getByRole("button", { name: "Clear session s1" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Compact session s1" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Expand session s1" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close session s1" }),
    ).toBeTruthy();
  });

  it("sends /clear, then a Ctrl+L redraw, in order on Clear", async () => {
    renderActions();
    screen.getByRole("button", { name: "Clear session s1" }).click();
    // The command is written first, synchronously...
    expect(writeSession).toHaveBeenNthCalledWith(1, "s1", "/clear\r");
    // ...then a form-feed (Ctrl+L) redraw once that write resolves, so the
    // running program repaints its screen after the command lands.
    await waitFor(() =>
      expect(writeSession).toHaveBeenNthCalledWith(2, "s1", "\f"),
    );
  });

  it("sends /compact, then a Ctrl+L redraw, in order on Compact", async () => {
    renderActions();
    screen.getByRole("button", { name: "Compact session s1" }).click();
    expect(writeSession).toHaveBeenNthCalledWith(1, "s1", "/compact\r");
    await waitFor(() =>
      expect(writeSession).toHaveBeenNthCalledWith(2, "s1", "\f"),
    );
  });

  it("calls onExpand with the session id when not expanded", () => {
    const { onExpand } = renderActions({ isExpanded: false });
    screen.getByRole("button", { name: "Expand session s1" }).click();
    expect(onExpand).toHaveBeenCalledWith("s1");
  });

  it("renders a Collapse control and calls onCollapse when expanded", () => {
    const { onCollapse } = renderActions({ isExpanded: true });
    const button = screen.getByRole("button", { name: "Collapse session" });
    button.click();
    expect(onCollapse).toHaveBeenCalledWith("s1");
    // The expand variant must not be present in the expanded state.
    expect(
      screen.queryByRole("button", { name: "Expand session s1" }),
    ).toBeNull();
  });

  it("calls onClose with the session id", () => {
    const { onClose } = renderActions();
    screen.getByRole("button", { name: "Close session s1" }).click();
    expect(onClose).toHaveBeenCalledWith("s1");
  });

  it("stops click propagation so the tile focus handler does not fire", () => {
    const onTileClick = vi.fn();
    render(
      <div onClick={onTileClick}>
        <SessionActions
          sessionId="s1"
          isExpanded={false}
          onExpand={vi.fn()}
          onCollapse={vi.fn()}
          onClose={vi.fn()}
        />
      </div>,
    );
    for (const name of [
      "Clear session s1",
      "Compact session s1",
      "Expand session s1",
      "Close session s1",
    ]) {
      screen.getByRole("button", { name }).click();
    }
    expect(onTileClick).not.toHaveBeenCalled();
  });

  it("gives each control a native title tooltip in the collapsed state", () => {
    renderActions({ isExpanded: false });
    expect(
      screen.getByRole("button", { name: "Clear session s1" }).title,
    ).toBe("Clear (/clear)");
    expect(
      screen.getByRole("button", { name: "Compact session s1" }).title,
    ).toBe("Compact (/compact)");
    expect(
      screen.getByRole("button", { name: "Expand session s1" }).title,
    ).toBe("Expand");
    expect(
      screen.getByRole("button", { name: "Close session s1" }).title,
    ).toBe("Close");
  });

  it("titles the Collapse control when expanded", () => {
    renderActions({ isExpanded: true });
    expect(
      screen.getByRole("button", { name: "Collapse session" }).title,
    ).toBe("Collapse");
  });

  it("hides the expand button when showExpand is false, keeping the others", () => {
    renderActions({ isExpanded: false, showExpand: false });
    expect(
      screen.queryByRole("button", { name: "Expand session s1" }),
    ).toBeNull();
    // The remaining controls are unaffected.
    expect(screen.getByRole("button", { name: "Clear session s1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compact session s1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close session s1" })).toBeTruthy();
  });

  it("hides the collapse button when showExpand is false even if expanded", () => {
    renderActions({ isExpanded: true, showExpand: false });
    expect(
      screen.queryByRole("button", { name: "Collapse session" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Expand session s1" }),
    ).toBeNull();
  });

  it("shows the expand button by default (showExpand omitted)", () => {
    renderActions();
    expect(
      screen.getByRole("button", { name: "Expand session s1" }),
    ).toBeTruthy();
  });
});
