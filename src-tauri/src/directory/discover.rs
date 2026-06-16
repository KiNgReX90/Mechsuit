//! On-demand workspace discovery: a bounded, git-aware filesystem walk that
//! collects candidate session groups under a root (e.g. `~/dev`).
//!
//! This is a plain, app-state-free function so it is trivially unit-tested and
//! reused by the MCP `discover_projects` tool. It reuses the sibling
//! [`super::persist`] git/last-modified detectors and a small ignore set, and
//! does not descend into a recorded repo's children or into heavy/ignored dirs.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::persist::{detect_git, detect_last_modified, display_name};

/// A discovery candidate. Discovery-specific (defined here, not in `models.rs`)
/// since it crosses only the MCP boundary. Serialized camelCase to match the TS
/// conventions used by the rest of the IPC contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDir {
    pub path: String,
    pub name: String,
    pub is_git_repo: bool,
    pub branch: Option<String>,
    /// Newest working-tree file mtime as Unix epoch **seconds**, or `None`.
    pub last_modified: Option<i64>,
    /// `true` exactly when this candidate's path is already in the persisted
    /// managed list supplied by the caller.
    pub already_managed: bool,
}

/// Directory names skipped outright (heavy build/dep output dirs). Any dot-dir
/// (a name starting with `.`, e.g. `.git`) is also skipped — see [`should_skip`].
const IGNORED: &[&str] = &["node_modules", "target", "dist"];

/// Whether a directory `name` should be skipped during the walk: dot-dirs (incl.
/// `.git`) and the heavy/ignored set are never descended into nor recorded.
fn should_skip(name: &str) -> bool {
    name.starts_with('.') || IGNORED.contains(&name)
}

/// Walk `root` to a bounded `max_depth`, collecting both git repositories and
/// plain directories as candidates. Skips `.git`/`node_modules`/`target`/`dist`
/// and any dot-dir, and does not descend into a repo's children once the repo
/// itself is recorded. `managed` is the persisted directory-path list; a
/// candidate is `already_managed` when its path appears there.
///
/// Never errors: unreadable dirs are skipped. `root` itself is the depth-0
/// boundary and is not recorded as a candidate; its qualifying children are.
pub fn discover(root: &str, max_depth: usize, managed: &[String]) -> Vec<DiscoveredDir> {
    let mut out = Vec::new();
    walk(Path::new(root), 1, max_depth, managed, &mut out);
    out
}

/// Recursive worker. `depth` is the depth of `dir`'s *children* (so the first
/// call passes 1). Stops descending past `max_depth`.
fn walk(dir: &Path, depth: usize, max_depth: usize, managed: &[String], out: &mut Vec<DiscoveredDir>) {
    if depth > max_depth {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if should_skip(name) {
            continue;
        }
        let path_str = path.to_string_lossy().into_owned();
        let (is_git_repo, branch) = detect_git(&path_str);
        out.push(DiscoveredDir {
            name: display_name(&path_str),
            already_managed: managed.iter().any(|m| m == &path_str),
            last_modified: detect_last_modified(&path_str),
            is_git_repo,
            branch,
            path: path_str,
        });
        // A recorded repo is a leaf candidate: do not descend into its children.
        if !is_git_repo {
            walk(&path, depth + 1, max_depth, managed, out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    /// A throwaway directory under the OS temp dir, removed on drop. Mirrors the
    /// helper in `persist.rs` to avoid a `tempfile` dependency.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(tag: &str) -> Self {
            let unique = format!(
                "mechsuit-discover-test-{tag}-{}-{:?}",
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

    fn mkdir(base: &Path, name: &str) -> PathBuf {
        let p = base.join(name);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn names(dirs: &[DiscoveredDir]) -> Vec<String> {
        dirs.iter().map(|d| d.name.clone()).collect()
    }

    fn find<'a>(dirs: &'a [DiscoveredDir], name: &str) -> &'a DiscoveredDir {
        dirs.iter()
            .find(|d| d.name == name)
            .unwrap_or_else(|| panic!("expected a discovered dir named {name}, got {:?}", names(dirs)))
    }

    /// Tree under `root`:
    ///   repo/            -> git repo (branch main), README.md
    ///     nested/        -> child of repo; must NOT be descended into
    ///   plain/           -> plain dir with a file
    ///     deep/          -> depth-2 plain dir
    ///   node_modules/    -> ignored
    ///   .hidden/         -> dot-dir, ignored
    fn build_tree(root: &Path) {
        let repo = mkdir(root, "repo");
        init_repo(&repo);
        mkdir(&repo, "nested");

        let plain = mkdir(root, "plain");
        std::fs::write(plain.join("note.txt"), b"hi").unwrap();
        mkdir(&plain, "deep");

        mkdir(root, "node_modules");
        mkdir(root, ".hidden");
    }

    #[test]
    fn finds_repos_and_plain_dirs_and_skips_ignored() {
        let root = TempDir::new("tree");
        build_tree(&root.path);

        let found = discover(&root.path_str(), 2, &[]);
        let ns = names(&found);

        assert!(ns.contains(&"repo".to_string()), "git repo is a candidate");
        assert!(ns.contains(&"plain".to_string()), "plain dir is a candidate");

        // Ignored / hidden dirs never appear.
        assert!(!ns.contains(&"node_modules".to_string()), "node_modules skipped");
        assert!(!ns.contains(&".hidden".to_string()), "dot-dir skipped");

        // A repo is recorded but its internals are not descended into.
        assert!(!ns.contains(&"nested".to_string()), "repo children not descended");

        // Git status is detected via detect_git.
        let repo = find(&found, "repo");
        assert!(repo.is_git_repo);
        assert_eq!(repo.branch.as_deref(), Some("main"));
        assert!(repo.last_modified.is_some(), "last_modified populated");

        let plain = find(&found, "plain");
        assert!(!plain.is_git_repo);
        assert_eq!(plain.branch, None);
    }

    #[test]
    fn descends_into_plain_dirs_to_max_depth() {
        let root = TempDir::new("depth");
        build_tree(&root.path);

        // depth 1: only top-level children; "deep" (a child of plain) is not reached.
        let shallow = discover(&root.path_str(), 1, &[]);
        let shallow_ns = names(&shallow);
        assert!(shallow_ns.contains(&"plain".to_string()));
        assert!(!shallow_ns.contains(&"deep".to_string()), "depth 1 stops at top level");

        // depth 2: the nested plain dir is now reached.
        let deeper = discover(&root.path_str(), 2, &[]);
        assert!(names(&deeper).contains(&"deep".to_string()), "depth 2 reaches nested plain dir");
    }

    #[test]
    fn already_managed_reflects_supplied_list() {
        let root = TempDir::new("managed");
        build_tree(&root.path);

        let plain_path = root.path.join("plain").to_string_lossy().into_owned();
        let managed = vec![plain_path.clone()];

        let found = discover(&root.path_str(), 2, &managed);

        let plain = find(&found, "plain");
        assert!(plain.already_managed, "managed path flagged true");
        assert_eq!(plain.path, plain_path);

        let repo = find(&found, "repo");
        assert!(!repo.already_managed, "unlisted path flagged false");
    }

    #[test]
    fn unreadable_or_missing_root_yields_empty() {
        let found = discover("/no/such/path/mechsuit-discover-xyzzy", 2, &[]);
        assert!(found.is_empty());
    }
}
