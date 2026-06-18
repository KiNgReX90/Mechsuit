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

/// The repository's name for `path` — the identity that the on-disk folder
/// belongs to, which often differs from the folder name (e.g. a clone in a
/// renamed directory, or a worktree). Prefers the remote `origin` basename so
/// it is stable across worktrees and renames; falls back to the worktree-aware
/// repo-root directory name when there is no remote. `None` when `path` is not
/// a git repo (or git cannot resolve it) — callers treat that as "no repo
/// identity beyond the folder name".
pub fn detect_repo(path: &str) -> Option<String> {
    if let Some(url) = remote_origin_url(path) {
        if let Some(name) = repo_name_from_url(&url) {
            return Some(name);
        }
    }
    repo_root_name(path)
}

/// The configured URL of the `origin` remote, or `None` when there is none
/// (or git fails / is missing).
fn remote_origin_url(path: &str) -> Option<String> {
    Command::new("git")
        .args(["-C", path, "remote", "get-url", "origin"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Parse a git remote URL into its repository name: the last path segment with
/// any trailing `.git` removed. Handles scp-style (`git@host:owner/repo.git`),
/// URL forms (`https://…/repo.git`, `ssh://…:22/team/repo`), bare local paths,
/// and a trailing slash. `None` when no non-empty segment remains.
pub fn repo_name_from_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/');
    // scp-style URLs separate the path with ':'; everything else uses '/'.
    let last = trimmed
        .rsplit(|c| c == '/' || c == ':')
        .next()
        .unwrap_or("");
    let name = last.strip_suffix(".git").unwrap_or(last).trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// The repo-root directory name, resolved to the MAIN worktree even when `path`
/// is a linked worktree. The common git dir (`--git-common-dir`) is shared by
/// every worktree and lives in the main worktree as `…/<repo>/.git`, so its
/// parent's name is the repository's name regardless of which worktree we are
/// standing in. `None` when git cannot resolve it (e.g. not a repo).
fn repo_root_name(path: &str) -> Option<String> {
    let common = Command::new("git")
        .args([
            "-C",
            path,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
        ])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())?;
    let common = Path::new(&common);
    // `…/<repo>/.git` -> the repo root is the parent; for an unusual layout
    // (bare repo, custom GIT_DIR) fall back to the common dir's own name.
    let root = if common.file_name().map(|n| n == ".git").unwrap_or(false) {
        common.parent()
    } else {
        Some(common)
    };
    root.and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
}

/// Recency of `path` as a Unix epoch **seconds** value, or `None` when it
/// cannot be determined.
///
/// For a git repo this is the **last commit time** (`git log -1 --format=%ct`):
/// a bounded, O(1) signal independent of the repo's file count. For a non-repo
/// — or a repo with no commits yet (or no `git`) — it falls back to a shallow
/// scan of the directory's direct entries' mtimes. Never an error: any failure
/// degrades to the fallback or `None` (mirrors `detect_git`'s tolerance).
///
/// This deliberately does NOT stat every tracked file. That earlier walk ran a
/// `stat` per file (tens of thousands for a large repo) on the synchronous
/// `list_directories` path that gates boot, so boot time scaled with repo size.
/// The trade-off is that purely-uncommitted working-tree edits no longer move
/// the value; for ordering workspaces by recent activity, last-commit time is
/// an ample and cheap proxy.
pub fn detect_last_modified(path: &str) -> Option<i64> {
    if let Some(ts) = git_last_commit_secs(path) {
        return Some(ts);
    }
    shallow_max_mtime(path)
}

/// Unix epoch **seconds** of `path`'s last commit (`git log -1 --format=%ct`).
/// `None` if `path` is not a repo, `git` is missing, the repo has no commits
/// yet, or the output does not parse — every such case falls back to the
/// shallow scan in [`detect_last_modified`].
fn git_last_commit_secs(path: &str) -> Option<i64> {
    let output = Command::new("git")
        .args(["-C", path, "log", "-1", "--format=%ct"])
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    String::from_utf8_lossy(&output.stdout).trim().parse::<i64>().ok()
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
    let repo = if is_git_repo { detect_repo(path) } else { None };
    DirectoryInfo {
        path: path.to_string(),
        name: display_name(path),
        is_git_repo,
        branch,
        repo,
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

/// Core of `reorder_directories`: re-emit the stored paths in the order given by
/// `ordered`. Only paths that are currently managed are honored (an unknown path
/// is ignored), and any managed path the request omits is appended in its prior
/// relative order — so a stale or partial order from the UI can never silently
/// drop a directory. Writes the result back to the store.
pub fn reorder(data_dir: &Path, ordered: &[String]) -> Result<(), String> {
    let current = read_paths(data_dir)?;
    let mut next: Vec<String> = Vec::with_capacity(current.len());
    // Honor the requested order, but only for paths we actually manage (and
    // never duplicate one the request lists twice).
    for p in ordered {
        if current.iter().any(|c| c == p) && !next.iter().any(|n| n == p) {
            next.push(p.clone());
        }
    }
    // Append any managed path the request omitted, preserving its prior order.
    for c in &current {
        if !next.iter().any(|n| n == c) {
            next.push(c.clone());
        }
    }
    write_paths(data_dir, &next)
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
    fn repo_name_from_url_handles_common_forms() {
        // HTTPS, with and without the `.git` suffix.
        assert_eq!(
            repo_name_from_url("https://github.com/KiNgReX90/Mechsuit.git").as_deref(),
            Some("Mechsuit")
        );
        assert_eq!(
            repo_name_from_url("https://github.com/KiNgReX90/Mechsuit").as_deref(),
            Some("Mechsuit")
        );
        // scp-style (the segment lives after the ':').
        assert_eq!(
            repo_name_from_url("git@github.com:KiNgReX90/Mechsuit.git").as_deref(),
            Some("Mechsuit")
        );
        // ssh:// URL with a port.
        assert_eq!(
            repo_name_from_url("ssh://git@host:22/team/Bar.git").as_deref(),
            Some("Bar")
        );
        // Local path remote.
        assert_eq!(repo_name_from_url("/srv/git/foo.git").as_deref(), Some("foo"));
        // Trailing slash is tolerated.
        assert_eq!(
            repo_name_from_url("https://h/x/Mechsuit.git/").as_deref(),
            Some("Mechsuit")
        );
        // Nothing usable -> None.
        assert_eq!(repo_name_from_url(""), None);
        assert_eq!(repo_name_from_url("   "), None);
        assert_eq!(repo_name_from_url(".git"), None);
    }

    #[test]
    fn detect_repo_prefers_remote_origin_basename() {
        let tmp = TempDir::new("repo-remote");
        init_repo(&tmp.path);
        // A remote whose basename differs from the (generated) folder name.
        git(
            &tmp.path,
            &["remote", "add", "origin", "https://github.com/acme/Mechsuit.git"],
        );
        assert_eq!(detect_repo(&tmp.path_str()).as_deref(), Some("Mechsuit"));
    }

    #[test]
    fn detect_repo_falls_back_to_repo_root_name() {
        let tmp = TempDir::new("repo-noremote");
        init_repo(&tmp.path);
        // No remote configured: the repo name is the repo-root directory name.
        let expected = tmp
            .path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(detect_repo(&tmp.path_str()), Some(expected));
    }

    #[test]
    fn detect_repo_is_worktree_aware_via_common_dir() {
        // A linked worktree (no remote) resolves to the MAIN repo's name, not
        // the worktree directory's own name.
        let tmp = TempDir::new("repo-main");
        init_repo(&tmp.path);
        let main_name = tmp.path.file_name().unwrap().to_string_lossy().into_owned();

        let wt = tmp.path.join("wt-feature");
        git(
            &tmp.path,
            &[
                "worktree",
                "add",
                "-b",
                "feature",
                wt.to_str().unwrap(),
            ],
        );
        let wt_repo = detect_repo(&wt.to_string_lossy());
        assert_eq!(
            wt_repo.as_deref(),
            Some(main_name.as_str()),
            "a worktree should report its main repo's name"
        );
    }

    #[test]
    fn detect_repo_non_repo_is_none() {
        let tmp = TempDir::new("repo-nongit");
        assert_eq!(detect_repo(&tmp.path_str()), None);
    }

    #[test]
    fn info_for_populates_repo_for_git_repos() {
        let tmp = TempDir::new("repo-info");
        init_repo(&tmp.path);
        git(
            &tmp.path,
            &["remote", "add", "origin", "git@github.com:acme/Widget.git"],
        );
        let info = info_for(&tmp.path_str());
        assert_eq!(info.repo.as_deref(), Some("Widget"));
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
    fn reorder_sets_new_order() {
        let store = TempDir::new("store-reorder");
        let a = TempDir::new("reorder-a");
        let b = TempDir::new("reorder-b");
        let c = TempDir::new("reorder-c");
        add(&store.path, a.path_str()).unwrap();
        add(&store.path, b.path_str()).unwrap();
        add(&store.path, c.path_str()).unwrap();

        reorder(&store.path, &[c.path_str(), a.path_str(), b.path_str()]).unwrap();

        let listed: Vec<String> =
            list(&store.path).unwrap().into_iter().map(|d| d.path).collect();
        assert_eq!(listed, vec![c.path_str(), a.path_str(), b.path_str()]);
    }

    #[test]
    fn reorder_ignores_unknown_and_appends_missing() {
        let store = TempDir::new("store-reorder2");
        let a = TempDir::new("reorder2-a");
        let b = TempDir::new("reorder2-b");
        let c = TempDir::new("reorder2-c");
        add(&store.path, a.path_str()).unwrap();
        add(&store.path, b.path_str()).unwrap();
        add(&store.path, c.path_str()).unwrap();

        // The request references an unknown path and omits `b`.
        let unknown = "/no/such/reorder/path".to_string();
        reorder(&store.path, &[c.path_str(), unknown, a.path_str()]).unwrap();

        let listed: Vec<String> =
            list(&store.path).unwrap().into_iter().map(|d| d.path).collect();
        // c, a from the request; unknown dropped; b appended (was omitted).
        assert_eq!(listed, vec![c.path_str(), a.path_str(), b.path_str()]);
    }

    #[test]
    fn reorder_empty_input_is_noop() {
        let store = TempDir::new("store-reorder3");
        let a = TempDir::new("reorder3-a");
        let b = TempDir::new("reorder3-b");
        add(&store.path, a.path_str()).unwrap();
        add(&store.path, b.path_str()).unwrap();

        reorder(&store.path, &[]).unwrap();

        let listed: Vec<String> =
            list(&store.path).unwrap().into_iter().map(|d| d.path).collect();
        assert_eq!(listed, vec![a.path_str(), b.path_str()]);
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
    fn detect_last_modified_tracks_last_commit_time() {
        let tmp = TempDir::new("lm-repo");
        init_repo(&tmp.path);
        let before = newest_secs(&tmp.path);

        // An *empty* commit advances the repo's last-commit time without
        // touching any working-tree file. Commit-time recency must rise; the
        // old working-tree-mtime scan would not have seen it. This is the
        // bounded, repo-size-independent signal that replaced the per-file
        // stat walk (which made boot scale with file count).
        std::thread::sleep(std::time::Duration::from_millis(1100));
        git(&tmp.path, &["commit", "-q", "--allow-empty", "-m", "empty"]);
        let after = newest_secs(&tmp.path);

        assert!(
            after > before,
            "a new commit should raise commit-time recency ({after} <= {before})"
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

        // A file under an ignored dir, written later (and never committed),
        // must NOT raise the value: recency is the last commit time, so
        // uncommitted churn — ignored or not — does not move it.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::create_dir_all(tmp.path.join("target")).unwrap();
        std::fs::write(tmp.path.join("target/huge.bin"), b"ignored").unwrap();
        let after = newest_secs(&tmp.path);

        assert_eq!(
            after, baseline,
            "an uncommitted file should not change the commit-time last-modified"
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
