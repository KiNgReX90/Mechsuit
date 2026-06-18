import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputEvent } from "../../types";

// --- ipc mocks -------------------------------------------------------------
// onSessionOutput resolves to an unlisten spy; we capture the callback so the
// test can drive synthetic output events.
const unlisten = vi.fn();
let outputCb: ((payload: OutputEvent) => void) | undefined;

vi.mock("../../ipc/events", () => ({
  onSessionOutput: vi.fn((cb: (payload: OutputEvent) => void) => {
    outputCb = cb;
    return Promise.resolve(unlisten);
  }),
}));

vi.mock("../../ipc/commands", () => ({
  writeSession: vi.fn(() => Promise.resolve()),
  resizeSession: vi.fn(() => Promise.resolve()),
}));

// --- xterm shim ------------------------------------------------------------
// jsdom can't render the xterm canvas, so replace it with a minimal fake that
// records the wiring we care about: write(), onData handler, dispose().
const writeSpy = vi.fn();
const disposeSpy = vi.fn();
const onDataDisposeSpy = vi.fn();
const focusSpy = vi.fn();
let dataHandler: ((data: string) => void) | undefined;

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = writeSpy;
    loadAddon = vi.fn();
    open = vi.fn();
    dispose = disposeSpy;
    focus = focusSpy;
    onData = (cb: (data: string) => void) => {
      dataHandler = cb;
      return { dispose: onDataDisposeSpy };
    };
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// ResizeObserver isn't implemented in jsdom.
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    },
  );
});

import { writeSession, resizeSession } from "../../ipc/commands";
import { useStatusStore } from "../../state/statusStore";
import { disposeTerminal } from "../../lib/terminalPool";
import { Terminal } from "./Terminal";

afterEach(() => {
  // Unmount any still-mounted tree (running component cleanup) BEFORE clearing
  // mocks, so leftover cleanup calls don't leak into the next test's counts.
  cleanup();
  // The pool keeps the instance alive across unmount; dispose it so each test
  // starts from a freshly-built terminal (new subscription + onData handler).
  disposeTerminal("s1");
  vi.clearAllMocks();
  outputCb = undefined;
  dataHandler = undefined;
});

describe("<Terminal />", () => {
  it("mounts and resizes the session via the fit addon", () => {
    render(<Terminal sessionId="s1" />);
    expect(resizeSession).toHaveBeenCalledWith("s1", 80, 24);
  });

  it("writes incoming output only for the matching sessionId", () => {
    render(<Terminal sessionId="s1" />);
    outputCb?.({ sessionId: "s1", data: "hello" });
    outputCb?.({ sessionId: "other", data: "ignored" });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith("hello");
  });

  it("forwards user keystrokes via writeSession", () => {
    render(<Terminal sessionId="s1" />);
    dataHandler?.("a");
    expect(writeSession).toHaveBeenCalledWith("s1", "a");
  });

  it("grabs DOM focus when mounted as the focused pane", () => {
    render(<Terminal sessionId="s1" focused />);
    expect(focusSpy).toHaveBeenCalled();
  });

  it("does not grab focus when it is not the focused pane", () => {
    render(<Terminal sessionId="s1" />);
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("grabs focus when `focused` flips true after mount", () => {
    const { rerender } = render(<Terminal sessionId="s1" focused={false} />);
    expect(focusSpy).not.toHaveBeenCalled();
    rerender(<Terminal sessionId="s1" focused />);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("arms a re-alert when the user submits a prompt (carriage return)", () => {
    useStatusStore.getState().setStatus("s1", "ready");
    useStatusStore.getState().acknowledge("s1");
    render(<Terminal sessionId="s1" />);

    dataHandler?.("\r");
    expect(useStatusStore.getState().statusBySession["s1"].promptedSinceAck).toBe(true);
  });

  it("does NOT arm a re-alert for input without a carriage return", () => {
    useStatusStore.getState().setStatus("s1", "ready");
    useStatusStore.getState().acknowledge("s1");
    render(<Terminal sessionId="s1" />);

    // Plain characters and a terminal focus-out escape carry no CR, so neither
    // typing-in-progress nor switching focus should re-arm the blink.
    dataHandler?.("h");
    dataHandler?.("\x1b[O");
    expect(useStatusStore.getState().statusBySession["s1"].promptedSinceAck).toBe(false);
  });

  it("keeps the terminal alive on unmount and tears it down only on disposeTerminal", async () => {
    const { unmount } = render(<Terminal sessionId="s1" />);
    // Flush microtasks so the onSessionOutput promise resolves and the
    // unlisten fn is stored before we tear the component down.
    await Promise.resolve();
    unmount();
    // Switching workspaces unmounts the pane but MUST NOT destroy it — the
    // xterm instance and its subscription stay live so it re-shows instantly.
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(unlisten).not.toHaveBeenCalled();
    expect(onDataDisposeSpy).not.toHaveBeenCalled();

    // Closing the session for good is the only thing that tears it down.
    disposeTerminal("s1");
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(onDataDisposeSpy).toHaveBeenCalledTimes(1);
  });
});
