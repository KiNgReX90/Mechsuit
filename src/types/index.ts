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

/**
 * A git worktree of a managed repository, enumerated from
 * `git worktree list --porcelain`. Mirrors the Rust `WorktreeInfo` (camelCase).
 */
export interface WorktreeInfo {
  /** Absolute path of the worktree's working directory. */
  path: string;
  /** Checked-out branch name (no `refs/heads/` prefix); null for detached HEAD. */
  branch: string | null;
  /** HEAD commit SHA; null when the record carries no HEAD (e.g. bare repo). */
  head: string | null;
  /** True for the repository's primary (first) worktree. */
  isPrimary: boolean;
  /** Path of the worktree this one is nested under, or null when not nested. */
  parentPath: string | null;
}

/** Kind of PTY session: a normal workspace pane, or the singular Commander. */
export type SessionKind = "workspace" | "commander";

/** A running PTY session, tracked per-directory. */
export interface SessionInfo {
  id: string;
  dirPath: string;
  /** Backend always sets this; optional only so older test fixtures still type. */
  kind?: SessionKind;
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
  /**
   * Whether the session's "ready" state needs no alert. Defaults to true for a
   * brand-new session, so a freshly-opened session that just finished starting
   * up is steady, not blinking. Goes false (blink) only when a "ready" follows a
   * submitted prompt (see {@link promptedSinceAck}); the user clears it by
   * focusing the tile. Stays true across incidental working→ready cycles, so
   * switching focus or background redraws never make a seen tile blink again.
   */
  acknowledged: boolean;
  /**
   * True when the user has submitted a prompt/command to the session since it
   * was last acknowledged. The NEXT transition to "ready" consumes this to
   * re-alert (reset `acknowledged`), so a tile only re-blinks after the user
   * actually engaged it — not on incidental output.
   */
  promptedSinceAck: boolean;
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
