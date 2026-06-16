//! Shared serde models for the IPC contract.
//!
//! Field names are serialized in camelCase to match the TypeScript mirror
//! (`ts-ipc-contract`). Do not change `rename_all` without updating the TS side.

use serde::{Deserialize, Serialize};

/// A user-added directory shown in the sidebar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryInfo {
    pub path: String,
    pub name: String,
    pub is_git_repo: bool,
    pub branch: Option<String>,
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
}
