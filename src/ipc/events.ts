/**
 * Event-subscription helpers for the PTY session event stream.
 *
 * Each helper subscribes to a Tauri event and returns a promise resolving to an
 * unlisten function; call it to tear down the subscription.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ExitEvent, OutputEvent } from "../types";

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
