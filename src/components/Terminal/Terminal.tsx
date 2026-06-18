import "./Terminal.css";

import { useEffect, useRef } from "react";

import { acquireTerminal, releaseTerminal, type TerminalPane } from "../../lib/terminalPool";

export interface TerminalProps {
  /** Session whose PTY this pane reads from and writes to. */
  sessionId: string;
  /**
   * Whether the app considers this pane the focused one. When it becomes true,
   * the terminal grabs DOM focus so keystrokes route here — keeping browser
   * focus in lockstep with the app's selection rather than relying on a click
   * landing exactly on the xterm textarea.
   */
  focused?: boolean;
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
export function Terminal({ sessionId, focused }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<TerminalPane | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pane = acquireTerminal(sessionId, container);
    paneRef.current = pane;

    // Keep the PTY sized to the visible pane while this tile is mounted.
    const resizeObserver = new ResizeObserver(() => pane.fit());
    resizeObserver.observe(container);
    pane.fit();

    return () => {
      resizeObserver.disconnect();
      paneRef.current = null;
      releaseTerminal(sessionId);
    };
  }, [sessionId]);

  // Keep DOM focus in lockstep with the app's focused-session selection. The
  // acquire effect above runs first (so the pane exists), then this grabs focus
  // when the pane is — or becomes — the focused one. Without this, browser focus
  // only ever moves on a click landing exactly on the xterm textarea, so it can
  // drift out of sync with `focusedSessionId` and keystrokes get routed to (or
  // swallowed by) the wrong pane.
  useEffect(() => {
    if (focused) paneRef.current?.focus();
  }, [focused, sessionId]);

  return <div ref={containerRef} className="terminal-pane" />;
}
