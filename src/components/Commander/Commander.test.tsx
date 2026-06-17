import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Commander } from "./Commander";

// Stub the Terminal so we assert wiring (which session id is mounted) without
// xterm/canvas in jsdom.
vi.mock("../Terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="commander-terminal" data-session-id={sessionId} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("<Commander />", () => {
  it("renders nothing when closed and never opened (no session)", () => {
    const { container } = render(
      <Commander open={false} sessionId={null} onClose={() => {}} onRelaunch={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("mounts the Commander terminal for its session when open", () => {
    render(
      <Commander open sessionId="cmd-1" onClose={() => {}} onRelaunch={() => {}} />,
    );
    const term = screen.getByTestId("commander-terminal");
    expect(term).toHaveAttribute("data-session-id", "cmd-1");
  });

  it("keeps the terminal mounted (process alive) while folded", () => {
    const { rerender } = render(
      <Commander open sessionId="cmd-1" onClose={() => {}} onRelaunch={() => {}} />,
    );
    expect(screen.getByTestId("commander-terminal")).toBeInTheDocument();

    // Fold it in: the drawer hides (aria-hidden) but the terminal stays mounted.
    rerender(
      <Commander open={false} sessionId="cmd-1" onClose={() => {}} onRelaunch={() => {}} />,
    );
    expect(screen.getByTestId("commander-terminal")).toBeInTheDocument();
    // Hidden from the a11y tree so role queries treat it as closed.
    expect(screen.queryByRole("dialog", { name: "Commander" })).toBeNull();
  });

  it("offers relaunch when open with no live session", () => {
    const onRelaunch = vi.fn();
    render(
      <Commander open sessionId={null} onClose={() => {}} onRelaunch={onRelaunch} />,
    );
    expect(screen.queryByTestId("commander-terminal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Relaunch Commander" }));
    expect(onRelaunch).toHaveBeenCalledTimes(1);
  });

  it("renders the Commander emblem and fires onClose from the close control", () => {
    const onClose = vi.fn();
    render(
      <Commander open sessionId="cmd-1" onClose={onClose} onRelaunch={() => {}} />,
    );
    expect(screen.getByTestId("commander-icon")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Commander" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("folds in (onClose) when the pointer goes down outside the drawer", () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <Commander open sessionId="cmd-1" onClose={onClose} onRelaunch={() => {}} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores outside pointer-downs while closed", () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <Commander open={false} sessionId="cmd-1" onClose={onClose} onRelaunch={() => {}} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
