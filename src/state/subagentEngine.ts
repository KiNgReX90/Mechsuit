/**
 * Subagent engine — derives each live session's one-level subagent list from
 * the PTY output stream and writes the passive `subagentStore`.
 *
 * It owns a single subscription to `session://output` and `session://exit` (via
 * `ipc/events`), keeps a bounded trailing buffer per session (like
 * `statusEngine` — never the whole stream), runs the pure `subagentParser` over
 * that tail to recognize Claude Code Task blocks, maps each Task's render state
 * to a `SessionStatus`, and replaces the session's list in `subagentStore`.
 * On `session://exit` it clears the session entirely.
 *
 * No new Tauri event is added — this is a second consumer of the same stream
 * `statusEngine` and `Terminal.tsx` already read. The store stays passive and
 * the parser stays pure; ALL subscription lifecycle lives here.
 *
 * The engine is STARTED by wi-04's graph liveness layer, so there is no
 * always-on parsing cost when the graph is closed. Two shapes are exported:
 * a plain `startSubagentEngine(): () => void` (call it, keep the returned
 * disposer) and a `<SubagentEngine/>` / `useSubagentEngine()` wrapper, mirroring
 * `statusEngine`.
 */
import { useEffect } from "react";

import { onSessionExit, onSessionOutput } from "../ipc/events";
import { parseSubagents, type TaskState } from "../lib/subagentParser";
import type { SessionStatus, SubagentNode } from "../types";
import { useSubagentStore } from "./subagentStore";

/**
 * Upper bound on the trailing-output buffer kept per session, in characters.
 * Only the tail matters to Task detection, so we never accumulate the whole
 * stream. A Task block (header + status line) is small, but headroom keeps a
 * Task header and its later status line in-window together. Matches the spirit
 * of `statusEngine.TRAILING_BUFFER_MAX`, sized larger for multi-line blocks.
 */
export const TRAILING_BUFFER_MAX = 8192;

/** Map a parsed Task render state to the shared four-state session status. */
function toStatus(state: TaskState): SessionStatus {
  switch (state) {
    case "done":
      return "ready";
    case "failed":
      return "error";
    case "running":
    default:
      return "working";
  }
}

/**
 * Recompute a session's full `SubagentNode[]` from its bounded trailing buffer.
 * Subagents are assigned stable, render-order ids within the session; the
 * status reflects the latest Task render state visible in the tail.
 */
function deriveNodes(sessionId: string, buffer: string): SubagentNode[] {
  return parseSubagents(buffer).map((obs, index) => ({
    id: `${sessionId}:sub-${index}`,
    label: obs.label,
    status: toStatus(obs.state),
  }));
}

/**
 * Start the subagent engine. Subscribes once to the output/exit streams and
 * returns a disposer that tears every subscription and buffer down. Safe to
 * call before the async listen handles resolve — a disposer invoked early
 * cancels the pending subscriptions.
 */
export function startSubagentEngine(): () => void {
  // Per-session bounded trailing-output buffers.
  const trailing = new Map<string, string>();
  let disposed = false;

  const handleOutput = (sessionId: string, data: string) => {
    // Append to the bounded trailing buffer (keep only the tail).
    const combined = (trailing.get(sessionId) ?? "") + data;
    const buffer =
      combined.length > TRAILING_BUFFER_MAX
        ? combined.slice(combined.length - TRAILING_BUFFER_MAX)
        : combined;
    trailing.set(sessionId, buffer);

    const nodes = deriveNodes(sessionId, buffer);
    // Only write when this session actually has subagents in view; a plain
    // shell / non-Claude session never gets an entry (degrade gracefully).
    if (nodes.length > 0) {
      useSubagentStore.getState().set(sessionId, nodes);
    } else if (useSubagentStore.getState().subagentsBySession[sessionId]) {
      // Tasks scrolled out of the bounded tail: reflect that the session has no
      // live subagents anymore rather than leaving a stale list.
      useSubagentStore.getState().set(sessionId, []);
    }
  };

  const handleExit = (sessionId: string) => {
    trailing.delete(sessionId);
    useSubagentStore.getState().clear(sessionId);
  };

  // Subscribe once; resolve unlisten handles, tearing down if we were disposed
  // before the promises settled.
  let unlistenOutput: (() => void) | undefined;
  let unlistenExit: (() => void) | undefined;

  void onSessionOutput((payload) => handleOutput(payload.sessionId, payload.data)).then((fn) => {
    if (disposed) fn();
    else unlistenOutput = fn;
  });
  void onSessionExit((payload) => handleExit(payload.sessionId)).then((fn) => {
    if (disposed) fn();
    else unlistenExit = fn;
  });

  return () => {
    disposed = true;
    unlistenOutput?.();
    unlistenExit?.();
    trailing.clear();
  };
}

/**
 * Run the subagent engine for the lifetime of the calling component. Starts on
 * mount and disposes on unmount. Use this (or `<SubagentEngine/>`) when mounting
 * declaratively; wi-04 may instead call `startSubagentEngine()` directly and
 * hold the disposer for the graph's lifetime.
 */
export function useSubagentEngine(): void {
  useEffect(() => startSubagentEngine(), []);
}

/**
 * Null-rendering component wrapper so the engine can be dropped in declaratively:
 * `<SubagentEngine/>`. Mirrors `<StatusEngine/>`.
 */
export function SubagentEngine(): null {
  useSubagentEngine();
  return null;
}
