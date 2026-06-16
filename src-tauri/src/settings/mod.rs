//! Persisted application settings + Tauri commands.
//!
//! The store is a JSON file (`settings.json`) in the app data dir holding the
//! workspace root used by directory discovery. Like [`crate::directory::persist`],
//! the read/write core is parameterized by a `data_dir` so it is exercised by
//! `#[cfg(test)]` against temporary directories without a Tauri `AppHandle`; the
//! command layer resolves the real app data dir.
//!
//! The default workspace root is derived at runtime from `$HOME` (`$HOME/dev`),
//! never a hardcoded home path. A missing or empty store yields that default.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::directory::data_dir;
use crate::models::Settings;

/// File name of the JSON store inside the app data dir.
pub const STORE_FILE: &str = "settings.json";

/// Subdirectory under `$HOME` used as the default workspace root.
const DEFAULT_WORKSPACE_SUBDIR: &str = "dev";

/// Runtime default workspace root: `$HOME/dev`, derived from the environment.
/// Falls back to a bare `dev` when `HOME` is unset (e.g. odd test/CI shells)
/// so callers always get a non-empty path rather than a hardcoded home path.
pub fn default_workspace_root() -> String {
    match std::env::var("HOME") {
        Ok(home) if !home.is_empty() => Path::new(&home)
            .join(DEFAULT_WORKSPACE_SUBDIR)
            .to_string_lossy()
            .into_owned(),
        _ => DEFAULT_WORKSPACE_SUBDIR.to_string(),
    }
}

/// Full path to the JSON store within `data_dir`.
pub fn store_path(data_dir: &Path) -> PathBuf {
    data_dir.join(STORE_FILE)
}

/// Read settings from `data_dir`. A missing or empty store yields defaults
/// (workspace root = runtime `$HOME/dev`); corrupt JSON is surfaced as `Err`.
pub fn read(data_dir: &Path) -> Result<Settings, String> {
    let file = store_path(data_dir);
    let bytes = match std::fs::read(&file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(defaults()),
        Err(e) => return Err(format!("failed to read {}: {e}", file.display())),
    };
    if bytes.is_empty() {
        return Ok(defaults());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("failed to parse {}: {e}", file.display()))
}

/// Write settings to `data_dir`, creating the directory tree if needed.
pub fn write(data_dir: &Path, settings: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("failed to create {}: {e}", data_dir.display()))?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;
    let file = store_path(data_dir);
    std::fs::write(&file, json).map_err(|e| format!("failed to write {}: {e}", file.display()))
}

/// Default settings with the runtime-derived workspace root.
fn defaults() -> Settings {
    Settings {
        workspace_root: default_workspace_root(),
    }
}

/// Resolved workspace root for `data_dir`: the persisted value when non-empty,
/// otherwise the runtime `$HOME/dev` default. Backs discovery's `root == None`
/// path so it always resolves to a usable directory.
pub fn resolved_workspace_root(data_dir: &Path) -> Result<String, String> {
    let settings = read(data_dir)?;
    if settings.workspace_root.trim().is_empty() {
        Ok(default_workspace_root())
    } else {
        Ok(settings.workspace_root)
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let dir = data_dir(&app)?;
    read(&dir)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let dir = data_dir(&app)?;
    write(&dir, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway directory under the OS temp dir, removed on drop. Mirrors the
    /// `directory::persist` test helper to avoid a `tempfile` dependency.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(tag: &str) -> Self {
            let unique = format!(
                "mechsuit-settings-test-{tag}-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let path = std::env::temp_dir().join(unique);
            std::fs::create_dir_all(&path).unwrap();
            TempDir { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn missing_store_yields_runtime_home_default() {
        let store = TempDir::new("missing");
        // SAFETY: single-threaded test; restored below.
        let prev = std::env::var("HOME").ok();
        std::env::set_var("HOME", "/tmp/fake-home-mechsuit");

        let settings = read(&store.path).unwrap();
        assert_eq!(settings.workspace_root, "/tmp/fake-home-mechsuit/dev");
        // The default must never be a literal /home/ruben path.
        assert!(!settings.workspace_root.starts_with("/home/ruben"));

        match prev {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
    }

    #[test]
    fn round_trips_workspace_root_through_temp_dir() {
        let store = TempDir::new("roundtrip");
        let custom = Settings {
            workspace_root: "/some/custom/projects".to_string(),
        };
        write(&store.path, &custom).unwrap();
        assert!(store_path(&store.path).exists());

        let reloaded = read(&store.path).unwrap();
        assert_eq!(reloaded.workspace_root, "/some/custom/projects");
    }

    #[test]
    fn resolved_root_uses_persisted_value_when_set() {
        let store = TempDir::new("resolved-set");
        write(
            &store.path,
            &Settings {
                workspace_root: "/configured/root".to_string(),
            },
        )
        .unwrap();
        assert_eq!(
            resolved_workspace_root(&store.path).unwrap(),
            "/configured/root"
        );
    }

    #[test]
    fn resolved_root_falls_back_to_runtime_default_when_empty() {
        let store = TempDir::new("resolved-empty");
        // SAFETY: single-threaded test; restored below.
        let prev = std::env::var("HOME").ok();
        std::env::set_var("HOME", "/tmp/another-home");

        // Persist an empty workspace root; resolution must fall back.
        write(
            &store.path,
            &Settings {
                workspace_root: String::new(),
            },
        )
        .unwrap();
        assert_eq!(
            resolved_workspace_root(&store.path).unwrap(),
            "/tmp/another-home/dev"
        );

        match prev {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
    }
}
