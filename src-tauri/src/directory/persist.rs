//! Persistence + git detection for the directory module.
//!
//! The store is a JSON file (`directories.json`) holding the list of added
//! directories. Git status (`is_git_repo` + `branch`) is NOT persisted; it is
//! re-evaluated at call time so the sidebar always reflects the live branch.
//!
//! Everything here is pure-ish (parameterized by a store directory + a path)
//! so it is exercised by `#[cfg(test)]` against temporary directories without
//! constructing a Tauri `AppHandle`.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::models::DirectoryInfo;

/// File name of the JSON store inside the app data dir.
pub const STORE_FILE: &str = "directories.json";

/// Persisted entry. Only `path` is stored; the display name and git status are
/// derived on read so they always reflect the current filesystem state.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredDir {
    path: String,
}

/// Full path to the JSON store within `data_dir`.
pub fn store_path(data_dir: &Path) -> PathBuf {
    data_dir.join(STORE_FILE)
}

/// Read the persisted path list from `data_dir`. A missing or empty store is
/// treated as an empty list (not an error). Corrupt JSON is surfaced as `Err`.
fn read_paths(data_dir: &Path) -> Result<Vec<String>, String> {
    let file = store_path(data_dir);
    let bytes = match std::fs::read(&file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("failed to read {}: {e}", file.display())),
    };
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    let stored: Vec<StoredDir> = serde_json::from_slice(&bytes)
        .map_err(|e| format!("failed to parse {}: {e}", file.display()))?;
    Ok(stored.into_iter().map(|s| s.path).collect())
}

/// Atomically-enough write the path list to `data_dir`, creating the directory
/// tree if needed.
fn write_paths(data_dir: &Path, paths: &[String]) -> Result<(), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("failed to create {}: {e}", data_dir.display()))?;
    let stored: Vec<StoredDir> = paths
        .iter()
        .map(|p| StoredDir { path: p.clone() })
        .collect();
    let json = serde_json::to_vec_pretty(&stored)
        .map_err(|e| format!("failed to serialize directory store: {e}"))?;
    let file = store_path(data_dir);
    std::fs::write(&file, json).map_err(|e| format!("failed to write {}: {e}", file.display()))
}

/// Derive the display name from the last path segment. Falls back to the full
/// path string for odd inputs (root, trailing-only separators, non-UTF8
/// segments that survived into the `String`).
pub fn display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| path.to_string())
}

/// Detect whether `path` is inside a git work tree and, if so, its current
/// branch. Detached HEAD yields a short SHA (or `None` if even that fails) and
/// is never an error. A missing `git` binary simply means "not a repo".
pub fn detect_git(path: &str) -> (bool, Option<String>) {
    let inside = Command::new("git")
        .args(["-C", path, "rev-parse", "--is-inside-work-tree"])
        .output();
    let is_repo = matches!(inside, Ok(o) if o.status.success()
        && String::from_utf8_lossy(&o.stdout).trim() == "true");
    if !is_repo {
        return (false, None);
    }

    // Symbolic branch name; "HEAD" indicates a detached HEAD.
    let branch = Command::new("git")
        .args(["-C", path, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|b| !b.is_empty());

    let branch = match branch.as_deref() {
        Some("HEAD") | None => detached_short_sha(path),
        Some(_) => branch,
    };

    (true, branch)
}

/// Short commit SHA for a detached HEAD; `None` on any failure (e.g. an empty
/// repo with no commits yet).
fn detached_short_sha(path: &str) -> Option<String> {
    Command::new("git")
        .args(["-C", path, "rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Newest working-tree file mtime for `path` as Unix epoch **seconds**, or
/// `None` when it cannot be determined.
///
/// Git-aware: for a repo, enumerate the files git would track or show via
/// `git ls-files --cached --others --exclude-standard -z` (so `.gitignore`'d /
/// heavy dirs like `node_modules`, `target` are skipped) and take the max
/// mtime. For a non-repo — or a repo that yields no files (e.g. empty, no
/// `git`) — fall back to a shallow scan of the directory's direct entries'
/// mtimes. Never an error: any failure degrades to the fallback or `None`
/// (mirrors `detect_git`'s tolerance).
pub fn detect_last_modified(path: &str) -> Option<i64> {
    if let Some(ts) = git_tracked_max_mtime(path) {
        return Some(ts);
    }
    shallow_max_mtime(path)
}

/// Max mtime (epoch seconds) over the files git would track/show for `path`.
/// `None` if `path` is not a repo, `git` is missing, the command fails, or no
/// listed file yields an mtime.
fn git_tracked_max_mtime(path: &str) -> Option<i64> {
    let output = Command::new("git")
        .args([
            "-C",
            path,
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .output()
        .ok()
        .filter(|o| o.status.success())?;

    let base = Path::new(path);
    let mut max: Option<i64> = None;
    for rel in output.stdout.split(|&b| b == 0) {
        if rel.is_empty() {
            continue;
        }
        let rel = String::from_utf8_lossy(rel);
        let ts = file_mtime_secs(&base.join(rel.as_ref()));
        max = max_opt(max, ts);
    }
    max
}

/// Max mtime (epoch seconds) over the direct entries of `path` (non-recursive),
/// including the directory itself. `None` if nothing is readable.
fn shallow_max_mtime(path: &str) -> Option<i64> {
    let base = Path::new(path);
    let mut max: Option<i64> = file_mtime_secs(base);
    if let Ok(entries) = std::fs::read_dir(base) {
        for entry in entries.flatten() {
            max = max_opt(max, file_mtime_secs(&entry.path()));
        }
    }
    max
}

/// Modified time of `path` as Unix epoch **seconds**; `None` on any failure.
fn file_mtime_secs(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

/// Keep the larger of an accumulator and a candidate, either possibly `None`.
fn max_opt(acc: Option<i64>, candidate: Option<i64>) -> Option<i64> {
    match (acc, candidate) {
        (Some(a), Some(c)) => Some(a.max(c)),
        (a, None) => a,
        (None, c) => c,
    }
}

/// Build a fresh [`DirectoryInfo`] for `path` with git status detected now.
fn info_for(path: &str) -> DirectoryInfo {
    let (is_git_repo, branch) = detect_git(path);
    DirectoryInfo {
        path: path.to_string(),
        name: display_name(path),
        is_git_repo,
        branch,
        last_modified: detect_last_modified(path),
    }
}

/// Core of `add_directory`: validate, persist (dedup by path), return info.
/// Parameterized by `data_dir` so tests drive it against a temp store.
pub fn add(data_dir: &Path, path: String) -> Result<DirectoryInfo, String> {
    if !Path::new(&path).exists() {
        return Err(format!("path does not exist: {path}"));
    }
    let mut paths = read_paths(data_dir)?;
    if !paths.iter().any(|p| p == &path) {
        paths.push(path.clone());
        write_paths(data_dir, &paths)?;
    }
    Ok(info_for(&path))
}

/// Core of `list_directories`: persisted paths with git status re-evaluated now.
pub fn list(data_dir: &Path) -> Result<Vec<DirectoryInfo>, String> {
    let paths = read_paths(data_dir)?;
    Ok(paths.iter().map(|p| info_for(p)).collect())
}

/// Core of `remove_directory`: drop the entry (no error if it was absent).
pub fn remove(data_dir: &Path, path: String) -> Result<(), String> {
    let mut paths = read_paths(data_dir)?;
    let before = paths.len();
    paths.retain(|p| p != &path);
    if paths.len() != before {
        write_paths(data_dir, &paths)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway directory under the OS temp dir, removed on drop. Avoids
    /// adding a `tempfile` dependency (Cargo.toml is single-owner).
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(tag: &str) -> Self {
            let unique = format!(
                "mechsuit-dir-test-{tag}-{}-{:?}",
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
        fn path_str(&self) -> String {
            self.path.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .expect("git invocation failed");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Initialize a repo with one commit on a deterministic branch name.
    fn init_repo(dir: &Path) {
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "test@example.com"]);
        git(dir, &["config", "user.name", "Test"]);
        std::fs::write(dir.join("README.md"), b"hi").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
    }

    #[test]
    fn display_name_uses_last_segment() {
        assert_eq!(display_name("/home/u/projects/foo"), "foo");
        assert_eq!(display_name("/home/u/projects/foo/"), "foo");
        // Root / degenerate input falls back to the full string, never panics.
        assert!(!display_name("/").is_empty());
    }

    #[test]
    fn detect_git_non_repo_is_false() {
        let tmp = TempDir::new("nongit");
        let (is_repo, branch) = detect_git(&tmp.path_str());
        assert!(!is_repo);
        assert_eq!(branch, None);
    }

    #[test]
    fn detect_git_reports_branch() {
        let tmp = TempDir::new("gitbranch");
        init_repo(&tmp.path);
        let (is_repo, branch) = detect_git(&tmp.path_str());
        assert!(is_repo);
        assert_eq!(branch.as_deref(), Some("main"));
    }

    #[test]
    fn detect_git_detached_head_is_sha_not_error() {
        let tmp = TempDir::new("detached");
        init_repo(&tmp.path);
        // Detach onto the current commit.
        git(&tmp.path, &["checkout", "-q", "--detach", "HEAD"]);
        let (is_repo, branch) = detect_git(&tmp.path_str());
        assert!(is_repo);
        // Either a short SHA or None — but never the literal "HEAD" and never
        // an error path.
        match branch {
            Some(b) => assert_ne!(b, "HEAD"),
            None => {}
        }
    }

    #[test]
    fn add_rejects_nonexistent_path() {
        let store = TempDir::new("store-missing");
        let result = add(&store.path, "/no/such/path/mechsuit-xyzzy".into());
        assert!(result.is_err());
    }

    #[test]
    fn add_list_remove_round_trip_and_dedup() {
        let store = TempDir::new("store-roundtrip");
        let target = TempDir::new("target");
        let tpath = target.path_str();

        // add returns populated info
        let info = add(&store.path, tpath.clone()).unwrap();
        assert_eq!(info.path, tpath);
        assert_eq!(info.name, display_name(&tpath));

        // adding the same path again is a no-op dedup, not a second entry
        add(&store.path, tpath.clone()).unwrap();
        let listed = list(&store.path).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, tpath);

        // remove drops the entry
        remove(&store.path, tpath.clone()).unwrap();
        assert!(list(&store.path).unwrap().is_empty());

        // removing an absent path is not an error
        remove(&store.path, tpath).unwrap();
    }

    #[test]
    fn persistence_survives_reload() {
        // A fresh `read` from the same store dir simulates a process restart:
        // there is no in-memory state, so reading the file back is the test.
        let store = TempDir::new("store-restart");
        let target = TempDir::new("target-restart");
        let tpath = target.path_str();

        add(&store.path, tpath.clone()).unwrap();
        assert!(store_path(&store.path).exists());

        // Re-read from disk: the path is still there.
        let reloaded = list(&store.path).unwrap();
        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded[0].path, tpath);
    }

    /// `detect_last_modified` for `dir`, asserting a value is present. Tests
    /// assert ordering (newer files raise it; ignored files do not) rather than
    /// absolute epoch values, avoiding an extra mtime-setting crate.
    fn newest_secs(dir: &Path) -> i64 {
        detect_last_modified(&dir.to_string_lossy()).expect("a value")
    }

    #[test]
    fn detect_last_modified_non_repo_yields_value() {
        let tmp = TempDir::new("lm-nonrepo");
        std::fs::write(tmp.path.join("a.txt"), b"x").unwrap();
        let ts = detect_last_modified(&tmp.path_str());
        assert!(ts.is_some(), "non-repo dir should yield a shallow mtime");
        // Sanity: it is a plausible recent epoch-seconds value.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(ts.unwrap() <= now + 5);
    }

    #[test]
    fn detect_last_modified_reflects_newest_repo_file() {
        let tmp = TempDir::new("lm-repo");
        init_repo(&tmp.path);
        let before = newest_secs(&tmp.path);

        // Write a brand-new (untracked-but-shown) file after a short gap so its
        // mtime is strictly newer; --others picks it up.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::write(tmp.path.join("fresh.rs"), b"// new").unwrap();
        let after = newest_secs(&tmp.path);

        assert!(
            after >= before,
            "newest file mtime should not go backwards ({after} < {before})"
        );
    }

    #[test]
    fn detect_last_modified_ignores_gitignored_files() {
        let tmp = TempDir::new("lm-ignored");
        init_repo(&tmp.path);
        std::fs::write(tmp.path.join(".gitignore"), b"target/\n").unwrap();
        git(&tmp.path, &["add", ".gitignore"]);
        git(&tmp.path, &["commit", "-q", "-m", "ignore"]);
        let baseline = newest_secs(&tmp.path);

        // A file under an ignored dir, written later, must NOT raise the value.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::create_dir_all(tmp.path.join("target")).unwrap();
        std::fs::write(tmp.path.join("target/huge.bin"), b"ignored").unwrap();
        let after = newest_secs(&tmp.path);

        assert_eq!(
            after, baseline,
            "an ignored file should not change the git-aware last-modified"
        );
    }

    #[test]
    fn list_includes_last_modified() {
        let store = TempDir::new("store-lm");
        let target = TempDir::new("target-lm");
        std::fs::write(target.path.join("note.txt"), b"hi").unwrap();
        let tpath = target.path_str();

        add(&store.path, tpath.clone()).unwrap();
        let listed = list(&store.path).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(
            listed[0].last_modified.is_some(),
            "list output should carry last_modified"
        );
    }

    #[test]
    fn list_reevaluates_git_branch() {
        let store = TempDir::new("store-reeval");
        let repo = TempDir::new("repo-reeval");
        init_repo(&repo.path);
        let rpath = repo.path_str();

        add(&store.path, rpath.clone()).unwrap();
        let listed = list(&store.path).unwrap();
        assert!(listed[0].is_git_repo);
        assert_eq!(listed[0].branch.as_deref(), Some("main"));

        // Switch branch; list() must reflect the new branch (re-evaluated, not
        // cached from add()).
        git(&repo.path, &["checkout", "-q", "-b", "feature"]);
        let listed = list(&store.path).unwrap();
        assert_eq!(listed[0].branch.as_deref(), Some("feature"));
    }
}
