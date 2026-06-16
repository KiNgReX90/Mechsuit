import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommanderEngine, CommanderMessage } from "../../lib/commander/types";
import { Commander } from "./Commander";

// A mock engine whose replies the test controls. ask() is a spy so we can
// assert the message + sessionId threaded into each call.
function makeEngine(replies: CommanderMessage[]): CommanderEngine {
  let turn = 0;
  return {
    ask: vi.fn((_message: string, _sessionId?: string) =>
      Promise.resolve(replies[turn++]),
    ),
  };
}

// Type into the message field and submit the form.
function send(text: string) {
  fireEvent.change(screen.getByLabelText("Message Commander"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("<Commander />", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <Commander open={false} onClose={() => {}} engine={makeEngine([])} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("submits input, calls engine.ask, and renders the reply as markdown", async () => {
    const engine = makeEngine([{ reply: "**bold reply**", sessionId: "c1" }]);
    render(<Commander open onClose={() => {}} engine={engine} />);

    send("hello");

    // User message rendered plain.
    expect(screen.getByText("hello")).toBeInTheDocument();
    // First turn carries no sessionId.
    expect(engine.ask).toHaveBeenCalledWith("hello", undefined);

    // Assistant reply rendered through react-markdown: **bold** -> <strong>.
    const strong = await screen.findByText("bold reply");
    expect(strong.tagName).toBe("STRONG");
  });

  it("threads the returned sessionId into the next ask call", async () => {
    const engine = makeEngine([
      { reply: "first", sessionId: "sess-42" },
      { reply: "second", sessionId: "sess-42" },
    ]);
    render(<Commander open onClose={() => {}} engine={engine} />);

    send("one");
    await screen.findByText("first");

    send("two");
    await screen.findByText("second");

    expect(engine.ask).toHaveBeenNthCalledWith(1, "one", undefined);
    expect(engine.ask).toHaveBeenNthCalledWith(2, "two", "sess-42");
  });

  it("shows a pending indicator while a reply is in flight and clears it on resolve", async () => {
    let resolve: (m: CommanderMessage) => void = () => {};
    const engine: CommanderEngine = {
      ask: vi.fn(
        () =>
          new Promise<CommanderMessage>((r) => {
            resolve = r;
          }),
      ),
    };
    render(<Commander open onClose={() => {}} engine={engine} />);

    send("wait");
    expect(screen.getByTestId("commander-pending")).toBeInTheDocument();

    resolve({ reply: "done", sessionId: "c1" });

    await waitFor(() =>
      expect(screen.queryByTestId("commander-pending")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("focuses the message input when opened", () => {
    render(<Commander open onClose={() => {}} engine={makeEngine([])} />);
    expect(screen.getByLabelText("Message Commander")).toHaveFocus();
  });

  it("focuses the input when toggled from closed to open", () => {
    const engine = makeEngine([]);
    const { rerender } = render(
      <Commander open={false} onClose={() => {}} engine={engine} />,
    );
    rerender(<Commander open onClose={() => {}} engine={engine} />);
    expect(screen.getByLabelText("Message Commander")).toHaveFocus();
  });

  it("renders the Commander emblem icon when open", () => {
    render(<Commander open onClose={() => {}} engine={makeEngine([])} />);
    expect(screen.getByTestId("commander-icon")).toBeInTheDocument();
  });

  it("fires onClose when the close control is activated", () => {
    const onClose = vi.fn();
    render(<Commander open onClose={onClose} engine={makeEngine([])} />);

    fireEvent.click(screen.getByRole("button", { name: "Close Commander" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
