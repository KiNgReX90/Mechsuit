/**
 * Frontend TypeScript types mirroring the Rust IPC models.
 *
 * Field names are camelCase to match the Rust `#[serde(rename_all = "camelCase")]`
 * models defined in `rust-ipc-contract`. Keep these in exact sync.
 */

/** A directory added to the sidebar; `branch` is null when not a git repo. */
export interface DirectoryInfo {
  path: string;
  name: string;
  isGitRepo: boolean;
  branch: string | null;
  /**
   * Newest working-tree file mtime as Unix epoch **seconds**; `null` when it
   * cannot be determined. Re-evaluated per `listDirectories` call.
   */
  lastModified: number | null;
}

/**
 * A candidate directory found by the backend's bounded discovery walk (under
 * `~/dev` by default), used to populate the sidebar's add-directory combobox.
 * Mirrors the Rust `DiscoveredDir` (camelCase).
 */
export interface DiscoveredDir {
  path: string;
  name: string;
  isGitRepo: boolean;
  branch: string | null;
  lastModified: number | null;
  /** True when this directory is already in the managed list. */
  alreadyManaged: boolean;
}

/** A running PTY session, tracked per-directory. */
export interface SessionInfo {
  id: string;
  dirPath: string;
}

/** Payload of the `session://output` event. */
export interface OutputEvent {
  sessionId: string;
  data: string;
}

/** Payload of the `session://exit` event. */
export interface ExitEvent {
  sessionId: string;
  code: number;
}

/** Derived status for a single PTY session, emitted by the status engine. */
export type SessionStatus = "working" | "awaiting-approval" | "ready" | "error";

/** Per-session status record held in statusStore. */
export interface SessionStatusState {
  status: SessionStatus;
  /** True once the user has acknowledged a "ready" session; reset to false on each new "ready". */
  acknowledged: boolean;
}

/** Application settings persisted by the backend. Mirrors the Rust camelCase model. */
export interface AppSettings {
  workspaceRoot: string;
}

/**
 * A single rolling-window usage bucket returned by the backend usage meter.
 * `resetsAt` is an RFC3339 timestamp string marking when the window closes.
 */
export interface UsageWindow {
  utilization: number;
  resetsAt: string; // RFC3339
}

/**
 * A point-in-time snapshot of Claude API usage, covering the 5-hour and
 * 7-day rolling windows. Mirrors the Rust `UsageSnapshot` (camelCase).
 */
export interface UsageSnapshot {
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
}

/**
 * Payload of the `usage://updated` event. Either `snapshot` carries the
 * latest data or `error` carries a human-readable failure reason; the other
 * field is null.
 */
export interface UsageUpdate {
  snapshot: UsageSnapshot | null;
  error: string | null;
}
