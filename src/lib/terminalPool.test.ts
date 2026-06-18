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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const loadAddonSpy = vi.fn();
let constructed = 0;
let dataHandler: ((data: string) => void) | undefined;

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = writeSpy;
    loadAddon = loadAddonSpy;
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

// CanvasAddon mock: jsdom has no 2D canvas renderer. Track construction and
// disposal so we can prove the renderer is attached on acquire and disposed on
// release without ever disposing the xterm instance itself.
let canvasConstructed = 0;
const canvasDisposeSpy = vi.fn();

vi.mock("@xterm/addon-canvas", () => ({
  CanvasAddon: class {
    dispose = canvasDisposeSpy;
    constructor() {
      canvasConstructed += 1;
    }
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
import { useSessionsStore } from "../state/sessionsStore";
import { useStatusStore } from "../state/statusStore";
import { useUiStore } from "../state/uiStore";
import {
  __setFlushScheduler,
  acquireTerminal,
  disposeTerminal,
  focusTerminal,
  releaseTerminal,
} from "./terminalPool";

/** Mark a set of session ids as grid/workspace panes (subject to the input
 *  gate) and select the active one, mirroring the live uiStore/sessionsStore. */
function seedActive(active: string | null, gridIds: string[]): void {
  useSessionsStore.setState({
    sessionsByDirectory: {
      "/repo": gridIds.map((id) => ({ id, dirPath: "/repo" })),
    },
  });
  useUiStore.setState({ focusedSessionId: active, expandedSessionId: null });
}

function newContainer(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

// The per-frame output flush is driven by requestAnimationFrame in the browser.
// vitest's jsdom backs rAF with a macrotask timer, which a single awaited
// microtask would not drain; swap in a microtask scheduler so the existing
// `await Promise.resolve()` pattern deterministically drives one flush.
beforeEach(() => {
  __setFlushScheduler({
    schedule: (cb) => {
      queueMicrotask(cb);
      return 0;
    },
    cancel: () => {},
  });
});

afterEach(() => {
  // The pool is a module-level singleton; tear down every session a test may
  // use so the next test starts from a clean slate (and the shared output
  // subscription is released once the pool empties).
  disposeTerminal("p1");
  disposeTerminal("p2");
  disposeTerminal("cmd");
  vi.clearAllMocks();
  constructed = 0;
  canvasConstructed = 0;
  outputCb = undefined;
  dataHandler = undefined;
  document.body.innerHTML = "";
  __setFlushScheduler(); // restore the environment default
  useSessionsStore.setState({ sessionsByDirectory: {} });
  useUiStore.setState({ focusedSessionId: null, expandedSessionId: null });
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
    await Promise.resolve(); // let the coalesced per-frame flush run
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

  it("only writes output destined for the matching session", async () => {
    acquireTerminal("p1", newContainer());
    outputCb?.({ sessionId: "p1", data: "mine" });
    outputCb?.({ sessionId: "other", data: "theirs" });
    await Promise.resolve(); // let the coalesced per-frame flush run
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

  it("routes the shared subscription to the addressed terminal", async () => {
    acquireTerminal("p1", newContainer());
    acquireTerminal("p2", newContainer());
    outputCb?.({ sessionId: "p2", data: "hi-p2" });
    await Promise.resolve(); // let the coalesced per-frame flush run
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

  // --- input gate: only the active session forwards keystrokes --------------

  it("forwards input from the active (focused) grid pane", () => {
    seedActive("p1", ["p1", "p2"]);
    acquireTerminal("p1", newContainer());
    dataHandler?.("x");
    expect(writeSession).toHaveBeenCalledWith("p1", "x");
  });

  it("drops stray input from a non-active grid pane (never reaches its PTY)", () => {
    // p2 is a real grid pane but p1 is the active one: a late keystroke that
    // lands on p2 after a click moved focus must NOT be written to p2's agent.
    seedActive("p1", ["p1", "p2"]);
    acquireTerminal("p2", newContainer());
    dataHandler?.("stray");
    expect(writeSession).not.toHaveBeenCalled();
  });

  it("a dropped carriage return on a non-active pane does not arm its prompt re-alert", () => {
    seedActive("p1", ["p1", "p2"]);
    acquireTerminal("p2", newContainer());
    const markPrompted = vi.spyOn(useStatusStore.getState(), "markPrompted");
    dataHandler?.("\r");
    expect(markPrompted).not.toHaveBeenCalled();
    expect(writeSession).not.toHaveBeenCalled();
    markPrompted.mockRestore();
  });

  it("forwards input when the active pane is the expanded session", () => {
    seedActive(null, ["p1", "p2"]);
    useUiStore.setState({ expandedSessionId: "p2" });
    acquireTerminal("p2", newContainer());
    dataHandler?.("e");
    expect(writeSession).toHaveBeenCalledWith("p2", "e");
  });

  it("does not gate the Commander session (it is not a grid pane)", () => {
    // The Commander PTY is never in any directory's session list and never the
    // focused/expanded grid session, so its input must always forward even
    // while a grid pane is the active one.
    seedActive("p1", ["p1"]);
    acquireTerminal("cmd", newContainer());
    dataHandler?.("voice");
    expect(writeSession).toHaveBeenCalledWith("cmd", "voice");
  });

  it("still markPrompts and forwards on carriage return for the active pane", () => {
    seedActive("p1", ["p1"]);
    acquireTerminal("p1", newContainer());
    const markPrompted = vi.spyOn(useStatusStore.getState(), "markPrompted");
    dataHandler?.("ls\r");
    expect(markPrompted).toHaveBeenCalledWith("p1");
    expect(writeSession).toHaveBeenCalledWith("p1", "ls\r");
    markPrompted.mockRestore();
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

  // --- canvas renderer lifecycle -------------------------------------------

  it("attaches a canvas renderer addon when a pane is acquired", () => {
    acquireTerminal("p1", newContainer());
    // The fit addon and the canvas renderer are both loaded onto the xterm.
    expect(canvasConstructed).toBe(1);
    expect(loadAddonSpy).toHaveBeenCalled();
  });

  it("disposes the canvas renderer on release WITHOUT disposing the xterm", () => {
    acquireTerminal("p1", newContainer());
    releaseTerminal("p1");
    // Renderer detaches with the surface, but the live instance survives.
    expect(canvasDisposeSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it("re-creates the canvas renderer on re-acquire after release", () => {
    acquireTerminal("p1", newContainer());
    releaseTerminal("p1");
    acquireTerminal("p1", newContainer());
    // xterm instance reused (scrollback intact); a fresh renderer is attached.
    expect(constructed).toBe(1);
    expect(canvasConstructed).toBe(2);
  });

  it("does not duplicate the canvas renderer if re-acquired while still attached", () => {
    const c = newContainer();
    acquireTerminal("p1", c);
    acquireTerminal("p1", c); // re-acquire without an intervening release
    expect(canvasConstructed).toBe(1);
  });

  it("disposes the canvas renderer on disposeTerminal", () => {
    acquireTerminal("p1", newContainer());
    disposeTerminal("p1");
    expect(canvasDisposeSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  // --- per-frame output coalescing -----------------------------------------

  it("coalesces a burst of chunks into a single ordered write per frame", async () => {
    acquireTerminal("p1", newContainer());
    outputCb?.({ sessionId: "p1", data: "a" });
    outputCb?.({ sessionId: "p1", data: "b" });
    outputCb?.({ sessionId: "p1", data: "c" });
    // Nothing written synchronously — the chunks are buffered for the frame.
    expect(writeSpy).not.toHaveBeenCalled();
    await Promise.resolve(); // drive the per-frame flush
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith("abc");
  });

  it("concatenates multi-byte chunks byte-exact, never re-splitting", async () => {
    acquireTerminal("p1", newContainer());
    // The Rust reader aligns chunks on UTF-8 boundaries; the pool only joins.
    outputCb?.({ sessionId: "p1", data: "héllo " });
    outputCb?.({ sessionId: "p1", data: "🚀 wörld" });
    await Promise.resolve();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith("héllo 🚀 wörld");
  });

  it("keeps each session's buffer separate when coalescing", async () => {
    acquireTerminal("p1", newContainer());
    acquireTerminal("p2", newContainer());
    outputCb?.({ sessionId: "p1", data: "one" });
    outputCb?.({ sessionId: "p2", data: "two" });
    outputCb?.({ sessionId: "p1", data: "-more" });
    await Promise.resolve();
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenCalledWith("one-more");
    expect(writeSpy).toHaveBeenCalledWith("two");
  });

  it("flushes a pending buffer before disposing the terminal (no lost output)", async () => {
    acquireTerminal("p1", newContainer());
    await Promise.resolve(); // resolve subscription
    outputCb?.({ sessionId: "p1", data: "tail" });
    // Dispose before the frame fires: the buffer must be flushed, not dropped.
    disposeTerminal("p1");
    expect(writeSpy).toHaveBeenCalledWith("tail");
  });

  it("does not write into a session after it has been disposed", async () => {
    acquireTerminal("p1", newContainer());
    await Promise.resolve();
    disposeTerminal("p1");
    writeSpy.mockClear();
    outputCb?.({ sessionId: "p1", data: "late" });
    await Promise.resolve();
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
