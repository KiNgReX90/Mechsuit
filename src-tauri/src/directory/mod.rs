//! Directory management commands.
//!
//! The command fns are thin: they resolve the Tauri v2 app data dir from the
//! injected `AppHandle` and delegate all logic (persistence + git detection)
//! to [`persist`], which is unit-tested against temporary directories.
//!
//! Adding `app: tauri::AppHandle` to these signatures is invisible to the JS
//! caller — `generate_handler!` injects it server-side, so `lib.rs` (which
//! lists commands by name only) is unchanged and the frontend still invokes
//! with just `{ path }`.

mod discover;
pub mod persist;

pub use discover::{discover, DiscoveredDir};

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::models::DirectoryInfo;

/// Default discovery root for [`discover_directories`] when the caller omits
/// one: the user's `~/dev`.
const DEFAULT_DISCOVER_ROOT: &str = "/home/ruben/dev";

/// Default bounded walk depth for discovery when omitted.
const DEFAULT_DISCOVER_DEPTH: usize = 2;

/// Resolve the app data dir for the JSON store, mapping any path-API failure
/// to a `String` error suitable for the IPC boundary.
///
/// Exposed (`pub`) so the in-process MCP server (`crate::mcp`) can persist
/// `add_project`/`remove_project` against the same store these commands use,
/// instead of re-implementing store-path resolution.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))
}

#[tauri::command]
pub fn add_directory(app: AppHandle, path: String) -> Result<DirectoryInfo, String> {
    let dir = data_dir(&app)?;
    persist::add(&dir, path)
}

#[tauri::command]
pub fn list_directories(app: AppHandle) -> Result<Vec<DirectoryInfo>, String> {
    let dir = data_dir(&app)?;
    persist::list(&dir)
}

#[tauri::command]
pub fn remove_directory(app: AppHandle, path: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    persist::remove(&dir, path)
}

/// Discover candidate directories under `root` (default `~/dev`) to a bounded
/// `depth` (default 2), flagging which are already managed. Backs the sidebar's
/// add-directory combobox so the user can pick a real directory instead of
/// typing a full path. Reuses the unit-tested [`discover`] walk; the managed
/// list is read from the same store `list_directories` returns.
#[tauri::command]
pub fn discover_directories(
    app: AppHandle,
    root: Option<String>,
    depth: Option<usize>,
) -> Result<Vec<DiscoveredDir>, String> {
    let root = root.unwrap_or_else(|| DEFAULT_DISCOVER_ROOT.to_string());
    let depth = depth.unwrap_or(DEFAULT_DISCOVER_DEPTH);
    let managed: Vec<String> = list_directories(app)?.into_iter().map(|d| d.path).collect();
    Ok(discover(&root, depth, &managed))
}
