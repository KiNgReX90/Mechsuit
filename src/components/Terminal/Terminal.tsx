import "./Terminal.css";

import { useEffect, useRef } from "react";

import { acquireTerminal, releaseTerminal } from "../../lib/terminalPool";

export interface TerminalProps {
  /** Session whose PTY this pane reads from and writes to. */
  sessionId: string;
}

/**
 * A single terminal pane bound to one PTY session.
 *
 * The xterm instance itself lives in the {@link acquireTerminal terminal pool},
 * not in this component, so it survives being unmounted when the user switches
 * workspaces. On mount this pane acquires its session's live terminal (attaching
 * its surface here and keeping the PTY sized to the visible pane); on unmount it
 * RELEASES it (detaching the DOM) without tearing it down, so returning re-shows
 * the same terminal with full scrollback and no flicker. Teardown happens only
 * when the session is closed (`sessionsStore.removeSession` → `disposeTerminal`).
 */
export function Terminal({ sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pane = acquireTerminal(sessionId, container);

    // Keep the PTY sized to the visible pane while this tile is mounted.
    const resizeObserver = new ResizeObserver(() => pane.fit());
    resizeObserver.observe(container);
    pane.fit();

    return () => {
      resizeObserver.disconnect();
      releaseTerminal(sessionId);
    };
  }, [sessionId]);

  return <div ref={containerRef} className="terminal-pane" />;
}
