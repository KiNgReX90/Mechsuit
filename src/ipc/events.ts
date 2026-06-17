/**
 * Event-subscription helpers for the PTY session event stream.
 *
 * Each helper subscribes to a Tauri event and returns a promise resolving to an
 * unlisten function; call it to tear down the subscription.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ExitEvent, OutputEvent, UsageUpdate } from "../types";

/** Subscribe to `session://output`; returns an unlisten function. */
export function onSessionOutput(
  cb: (payload: OutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<OutputEvent>("session://output", (event) => cb(event.payload));
}

/** Subscribe to `session://exit`; returns an unlisten function. */
export function onSessionExit(
  cb: (payload: ExitEvent) => void,
): Promise<UnlistenFn> {
  return listen<ExitEvent>("session://exit", (event) => cb(event.payload));
}

/**
 * Subscribe to `commander://navigate`; returns an unlisten function. The
 * payload is the bare directory path string Commander resolved, used to select
 * that directory in the sidebar.
 */
export function onCommanderNavigate(
  cb: (path: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("commander://navigate", (event) => cb(event.payload));
}

/**
 * Subscribe to `commander://directories-changed`; returns an unlisten function.
 * Fired when a Commander MCP tool (`add_project` / `remove_project`) mutates the
 * managed directory list — the sidebar reloads it so the change shows up live
 * instead of only in the persisted store. The payload is empty.
 */
export function onCommanderDirectoriesChanged(
  cb: () => void,
): Promise<UnlistenFn> {
  return listen("commander://directories-changed", () => cb());
}

/**
 * Subscribe to `usage://updated`; returns an unlisten function. Fired by the
 * backend meter whenever the rolling-window snapshot changes. The payload is a
 * `UsageUpdate` carrying either fresh data or an error string.
 */
export function onUsageUpdated(
  cb: (u: UsageUpdate) => void,
): Promise<UnlistenFn> {
  return listen<UsageUpdate>("usage://updated", (event) => cb(event.payload));
}

/**
 * Subscribe to `session://paused`; returns an unlisten function. Fired when a
 * session is OS-suspended/resumed (by Commander or the tile resume control).
 */
export function onSessionPaused(
  cb: (payload: { sessionId: string; paused: boolean }) => void,
): Promise<UnlistenFn> {
  return listen<{ sessionId: string; paused: boolean }>(
    "session://paused",
    (event) => cb(event.payload),
  );
}
