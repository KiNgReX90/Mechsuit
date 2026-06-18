/**
 * Typed `invoke` wrappers for every Tauri command in the IPC contract.
 *
 * Each function maps 1:1 to a Rust command and carries the camelCase argument
 * shape expected by the backend. Components and stores call these instead of
 * touching `invoke` directly.
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  AppSettings,
  DirectoryInfo,
  DiscoveredDir,
  SessionInfo,
  UsageSnapshot,
  WorktreeInfo,
} from "../types";

/** Add a directory to the managed list, returning its resolved info. */
export function addDirectory(path: string): Promise<DirectoryInfo> {
  return invoke<DirectoryInfo>("add_directory", { path });
}

/**
 * Discover candidate directories under `root` (defaults to the user's `~/dev`)
 * to a bounded `depth`, each flagged with `alreadyManaged`. Backs the sidebar's
 * add-directory combobox.
 */
export function discoverDirectories(
  root?: string,
  depth?: number,
): Promise<DiscoveredDir[]> {
  return invoke<DiscoveredDir[]>("discover_directories", { root, depth });
}

/** List all managed directories. */
export function listDirectories(): Promise<DirectoryInfo[]> {
  return invoke<DirectoryInfo[]>("list_directories");
}

/** Remove a directory from the managed list. */
export function removeDirectory(path: string): Promise<void> {
  return invoke<void>("remove_directory", { path });
}

/** Spawn a PTY session rooted at the given directory; returns its info. */
export function spawnSession(dirPath: string): Promise<SessionInfo> {
  return invoke<SessionInfo>("spawn_session", { dirPath });
}

/** Write input bytes to a session's PTY. */
export function writeSession(sessionId: string, data: string): Promise<void> {
  return invoke<void>("write_session", { sessionId, data });
}

/** Resize a session's PTY to the given column/row dimensions. */
export function resizeSession(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke<void>("resize_session", { sessionId, cols, rows });
}

/** Kill a running session. */
export function killSession(sessionId: string): Promise<void> {
  return invoke<void>("kill_session", { sessionId });
}

/** List all sessions (optionally the backend filters per-directory). */
export function listSessions(): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("list_sessions");
}

/**
 * Spawn (or return the existing) Commander terminal session — an interactive
 * `claude` rooted at the user's home, wired to mechsuit's MCP tools. Idempotent:
 * repeated calls return the same live session.
 */
export function spawnCommanderSession(): Promise<SessionInfo> {
  return invoke<SessionInfo>("spawn_commander_session");
}

/** Retrieve the persisted application settings. */
export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

/** Persist application settings. */
export function setSettings(settings: AppSettings): Promise<void> {
  return invoke<void>("set_settings", { settings });
}

/**
 * Fetch the current usage snapshot from the backend meter. Rejects when the
 * backend returns an error (e.g. the Anthropic API is unreachable).
 */
export function getUsage(): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>("get_usage");
}

/** Pause (true) or resume (false) a single session by id. */
export function setSessionPaused(sessionId: string, paused: boolean): Promise<void> {
  return invoke<void>("set_session_paused", { sessionId, paused });
}

/**
 * List the git worktrees of the managed repository at `repoPath` — the primary
 * worktree plus any linked worktrees. A non-git directory or any git failure
 * resolves to an empty array (never rejects).
 */
export function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_worktrees", { repoPath });
}
