//! Shared serde models for the IPC contract.
//!
//! Field names are serialized in camelCase to match the TypeScript mirror
//! (`ts-ipc-contract`). Do not change `rename_all` without updating the TS side.

use serde::{Deserialize, Serialize};

/// What a PTY session is: a normal workspace pane, or the singular Commander.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionKind {
    Workspace,
    Commander,
}

/// A user-added directory shown in the sidebar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryInfo {
    pub path: String,
    pub name: String,
    pub is_git_repo: bool,
    pub branch: Option<String>,
    /// The repository's name, distinct from the on-disk folder `name`: the
    /// remote `origin` basename when there is one, else the (worktree-aware)
    /// repo-root directory name. `None` for a non-git directory. Re-evaluated
    /// per `list_directories` call alongside git status; not persisted.
    pub repo: Option<String>,
    /// Newest working-tree file mtime as Unix epoch **seconds**. `None` when it
    /// cannot be determined. Re-evaluated per `list_directories` call (like git
    /// status); not persisted.
    pub last_modified: Option<i64>,
}

/// A PTY-backed session belonging to a directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub dir_path: String,
    pub kind: SessionKind,
}

/// A git worktree of a managed repository, as enumerated by
/// `git worktree list --porcelain`. One per record in that output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    /// Absolute path of the worktree's working directory.
    pub path: String,
    /// Checked-out branch name (no `refs/heads/` prefix), or `None` for a
    /// detached HEAD.
    pub branch: Option<String>,
    /// HEAD commit SHA, or `None` when the record carries no `HEAD` line
    /// (e.g. a bare repository).
    pub head: Option<String>,
    /// `true` for the repository's primary (first) worktree.
    pub is_primary: bool,
    /// Path of the worktree this one is nested under (a strict path-prefix
    /// ancestor within the returned set), or `None` when not nested.
    pub parent_path: Option<String>,
}

/// Persisted application settings.
///
/// `workspace_root` is the directory discovery scans when no explicit root is
/// given. A missing/empty store yields the runtime default (`$HOME/dev`),
/// derived in [`crate::settings`] rather than hardcoded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub workspace_root: String,
}
