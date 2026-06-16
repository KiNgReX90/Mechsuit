import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { resizeSession, writeSession } from "../../ipc/commands";
import { onSessionOutput } from "../../ipc/events";

export interface TerminalProps {
  /** Session whose PTY this pane reads from and writes to. */
  sessionId: string;
}

/**
 * A single terminal pane bound to one PTY session.
 *
 * Mounts an xterm.js instance, streams `session://output` for the matching
 * `sessionId` into it, forwards user keystrokes via `writeSession`, and keeps
 * the PTY dimensions in sync via the fit addon + `resizeSession`. All listeners,
 * observers, and the xterm instance are torn down on unmount.
 */
export function Terminal({ sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Theme the terminal to match the app's "command deck" palette so panes
    // blend into their tiles instead of being stark black rectangles.
    const term = new XTerm({
      fontFamily:
        '"JetBrains Mono", "SF Mono", ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#0a0d13",
        foreground: "#e8edf6",
        cursor: "#5b8cff",
        cursorAccent: "#0a0d13",
        selectionBackground: "rgba(91, 140, 255, 0.35)",
        black: "#0a0d13",
        brightBlack: "#3a455c",
        red: "#f76d6d",
        brightRed: "#ff8a8a",
        green: "#3fb950",
        brightGreen: "#56d364",
        yellow: "#e3a13a",
        brightYellow: "#f0c060",
        blue: "#5b8cff",
        brightBlue: "#79a2ff",
        magenta: "#bb87ff",
        brightMagenta: "#d2a8ff",
        cyan: "#2fe0c8",
        brightCyan: "#6ff0dd",
        white: "#c8d2e0",
        brightWhite: "#e8edf6",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Forward user keystrokes to the PTY.
    const dataDisposable = term.onData((data) => {
      void writeSession(sessionId, data);
    });

    // Stream output destined for THIS session only.
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void onSessionOutput((payload) => {
      if (payload.sessionId === sessionId) {
        term.write(payload.data);
      }
    }).then((fn) => {
      if (disposed) {
        // Unmounted before the subscription resolved — tear it down now.
        fn();
      } else {
        unlisten = fn;
      }
    });

    // Keep the PTY sized to the visible pane.
    const applyFit = () => {
      fitAddon.fit();
      void resizeSession(sessionId, term.cols, term.rows);
    };
    const resizeObserver = new ResizeObserver(() => applyFit());
    resizeObserver.observe(container);
    applyFit();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      unlisten?.();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="terminal-pane" />;
}
