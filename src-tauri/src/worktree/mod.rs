//! Worktree discovery command.
//!
//! Thin Tauri command over the unit-tested [`list`] module: it enumerates the
//! git worktrees of a managed repository for the frontend. The worktree axis of
//! the sessions graph spine — distinct from the subagent axis.

mod list;

pub use list::list_worktrees as list_worktrees_for;

use crate::models::WorktreeInfo;

/// Enumerate the git worktrees of the repository at `repo_path` — the primary
/// worktree plus any linked worktrees — parsed from
/// `git worktree list --porcelain`. A non-git directory or any git failure
/// yields an empty list, never an error (see [`list::list_worktrees`]).
#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Vec<WorktreeInfo> {
    list_worktrees_for(&repo_path)
}
