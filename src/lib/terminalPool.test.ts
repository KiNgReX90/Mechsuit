/**
 * terminalPool unit tests (Vitest; xterm + ipc layers mocked).
 *
 * The pool keeps one live xterm instance per session ALIVE across detach/attach
 * so workspaces switch with zero visual difference. These tests pin that:
 *  - one xterm is built per session and reused forever (never reconstructed);
 *  - release detaches the surface from the DOM but never disposes the instance,
 *    and the instance keeps consuming output while hidden;
 *  - dispose is the only teardown — it disposes xterm, the input handler, and
 *    the output subscription, after which a fresh instance is built on demand.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputEvent } from "../types";

// --- xterm shim ------------------------------------------------------------
// jsdom can't render the xterm canvas; a minimal fake records the wiring we
// assert on. `constructed` counts instantiations so we can prove reuse.
const writeSpy = vi.fn();
const disposeSpy = vi.fn();
const onDataDisposeSpy = vi.fn();
const fitSpy = vi.fn();
const openSpy = vi.fn();
const focusSpy = vi.fn();
let constructed = 0;
let dataHandler: ((data: string) => void) | undefined;

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = writeSpy;
    loadAddon = vi.fn();
    open = openSpy;
    dispose = disposeSpy;
    focus = focusSpy;
    constructor() {
      constructed += 1;
    }
    onData = (cb: (data: string) => void) => {
      dataHandler = cb;
      return { dispose: onDataDisposeSpy };
    };
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = fitSpy;
  },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// --- ipc shims -------------------------------------------------------------
const unlisten = vi.fn();
let outputCb: ((payload: OutputEvent) => void) | undefined;

vi.mock("../ipc/events", () => ({
  onSessionOutput: vi.fn((cb: (payload: OutputEvent) => void) => {
    outputCb = cb;
    return Promise.resolve(unlisten);
  }),
}));

vi.mock("../ipc/commands", () => ({
  writeSession: vi.fn(() => Promise.resolve()),
  resizeSession: vi.fn(() => Promise.resolve()),
}));

import { resizeSession, writeSession } from "../ipc/commands";
import { onSessionOutput } from "../ipc/events";
import {
  acquireTerminal,
  disposeTerminal,
  focusTerminal,
  releaseTerminal,
} from "./terminalPool";

function newContainer(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  // The pool is a module-level singleton; tear down every session a test may
  // use so the next test starts from a clean slate (and the shared output
  // subscription is released once the pool empties).
  disposeTerminal("p1");
  disposeTerminal("p2");
  vi.clearAllMocks();
  constructed = 0;
  outputCb = undefined;
  dataHandler = undefined;
  document.body.innerHTML = "";
});

describe("terminalPool", () => {
  it("builds one xterm and mounts its surface into the container", () => {
    const c = newContainer();
    acquireTerminal("p1", c);
    expect(constructed).toBe(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(c.childElementCount).toBe(1);
  });

  it("reuses the same instance on re-acquire (never reconstructs)", () => {
    const c = newContainer();
    const first = acquireTerminal("p1", c);
    const second = acquireTerminal("p1", c);
    expect(constructed).toBe(1);
    expect(second).toBe(first);
  });

  it("release detaches the surface from the DOM without disposing", () => {
    const c = newContainer();
    acquireTerminal("p1", c);
    releaseTerminal("p1");
    expect(c.childElementCount).toBe(0);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it("keeps streaming output into a released (hidden) terminal", async () => {
    acquireTerminal("p1", newContainer());
    await Promise.resolve(); // let the onSessionOutput subscription resolve
    releaseTerminal("p1");
    outputCb?.({ sessionId: "p1", data: "background" });
    expect(writeSpy).toHaveBeenCalledWith("background");
  });

  it("re-attaches the surviving surface on re-acquire after release", async () => {
    acquireTerminal("p1", newContainer());
    await Promise.resolve();
    releaseTerminal("p1");
    const c2 = newContainer();
    acquireTerminal("p1", c2);
    expect(constructed).toBe(1); // not rebuilt
    expect(c2.childElementCount).toBe(1); // re-attached
  });

  it("only writes output destined for the matching session", () => {
    acquireTerminal("p1", newContainer());
    outputCb?.({ sessionId: "p1", data: "mine" });
    outputCb?.({ sessionId: "other", data: "theirs" });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith("mine");
  });

  it("registers ONE shared output subscription regardless of terminal count", () => {
    // Per-terminal subscriptions would fan every chunk out to all panes; the
    // pool instead routes a single subscription by sessionId. Acquiring many
    // terminals must not multiply the listener count.
    acquireTerminal("p1", newContainer());
    acquireTerminal("p2", newContainer());
    expect(onSessionOutput).toHaveBeenCalledTimes(1);
  });

  it("routes the shared subscription to the addressed terminal", () => {
    acquireTerminal("p1", newContainer());
    acquireTerminal("p2", newContainer());
    outputCb?.({ sessionId: "p2", data: "hi-p2" });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith("hi-p2");
  });

  it("pane.focus and focusTerminal move DOM focus onto the xterm", () => {
    const pane = acquireTerminal("p1", newContainer());
    pane.focus();
    expect(focusSpy).toHaveBeenCalledTimes(1);
    focusTerminal("p1");
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it("focusTerminal is a no-op for an unknown session", () => {
    focusTerminal("nope");
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("forwards keystrokes to the session via writeSession", () => {
    acquireTerminal("p1", newContainer());
    dataHandler?.("x");
    expect(writeSession).toHaveBeenCalledWith("p1", "x");
  });

  it("pane.fit resizes the PTY to the terminal's dimensions", () => {
    const pane = acquireTerminal("p1", newContainer());
    pane.fit();
    expect(fitSpy).toHaveBeenCalled();
    expect(resizeSession).toHaveBeenCalledWith("p1", 80, 24);
  });

  it("dispose tears down xterm and the input handler; emptying the pool releases the shared subscription", async () => {
    acquireTerminal("p1", newContainer());
    await Promise.resolve();
    disposeTerminal("p1");
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(onDataDisposeSpy).toHaveBeenCalledTimes(1);
    // Disposing the last terminal empties the pool, so the single shared
    // output subscription is released.
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("keeps the shared subscription alive while other terminals remain", async () => {
    acquireTerminal("p1", newContainer());
    acquireTerminal("p2", newContainer());
    await Promise.resolve();
    disposeTerminal("p1");
    // p2 still lives, so the subscription must not be torn down.
    expect(unlisten).not.toHaveBeenCalled();
    disposeTerminal("p2");
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("builds a fresh instance when acquired again after dispose", () => {
    acquireTerminal("p1", newContainer());
    disposeTerminal("p1");
    acquireTerminal("p1", newContainer());
    expect(constructed).toBe(2);
  });
});
