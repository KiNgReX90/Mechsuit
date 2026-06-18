//! Git worktree enumeration for a managed repository.
//!
//! Shells out to `git worktree list --porcelain` for a repo path and parses
//! the records into [`WorktreeInfo`]. The parser and the `parentPath` nesting
//! derivation are pure functions (no process, no I/O) so they are exercised by
//! `#[cfg(test)]` against captured porcelain text without a real repo — mirrors
//! the git-test convention in `super::super::directory::persist`.
//!
//! Tolerant by contract: a non-git directory, a missing `git` binary, or any
//! git failure yields an empty list, never an error that breaks the caller.

use std::path::Path;
use std::process::Command;

use crate::models::WorktreeInfo;

/// Enumerate the worktrees of the repository at `repo_path`: the primary
/// worktree plus any linked worktrees. Returns an empty list for a non-repo,
/// a missing `git`, or any git failure (never an error — see module docs).
pub fn list_worktrees(repo_path: &str) -> Vec<WorktreeInfo> {
    let output = Command::new("git")
        .args(["-C", repo_path, "worktree", "list", "--porcelain"])
        .output();
    let stdout = match output {
        Ok(o) if o.status.success() => o.stdout,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&stdout);
    let mut worktrees = parse_porcelain(&text);
    derive_parent_paths(&mut worktrees);
    worktrees
}

/// Parse `git worktree list --porcelain` output into worktrees. Records are
/// separated by blank lines; each begins with a `worktree <path>` line and may
/// carry `HEAD <sha>` and either `branch refs/heads/<name>` or `detached`. The
/// first record is the primary worktree. `parentPath` is left `None` here and
/// filled by [`derive_parent_paths`].
fn parse_porcelain(text: &str) -> Vec<WorktreeInfo> {
    let mut out: Vec<WorktreeInfo> = Vec::new();
    let mut current: Option<WorktreeInfo> = None;
    let mut is_first = true;

    for line in text.lines() {
        if line.is_empty() {
            // Blank line terminates the current record.
            if let Some(wt) = current.take() {
                out.push(wt);
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            // A new record always starts with `worktree`; flush any prior one
            // that was not closed by a blank line (defensive — git emits a
            // trailing blank, but tolerate input that does not).
            if let Some(wt) = current.take() {
                out.push(wt);
            }
            current = Some(WorktreeInfo {
                path: path.to_string(),
                branch: None,
                head: None,
                is_primary: is_first,
                parent_path: None,
            });
            is_first = false;
        } else if let Some(sha) = line.strip_prefix("HEAD ") {
            if let Some(wt) = current.as_mut() {
                wt.head = Some(sha.to_string());
            }
        } else if let Some(refname) = line.strip_prefix("branch ") {
            if let Some(wt) = current.as_mut() {
                wt.branch = Some(short_branch(refname));
            }
        }
        // `detached`, `bare`, `locked`, etc. leave branch as `None`.
    }
    if let Some(wt) = current.take() {
        out.push(wt);
    }
    out
}

/// Strip a leading `refs/heads/` from a porcelain `branch` ref, leaving the
/// short branch name. Unknown ref shapes are returned unchanged.
fn short_branch(refname: &str) -> String {
    refname
        .strip_prefix("refs/heads/")
        .unwrap_or(refname)
        .to_string()
}

/// Fill each worktree's `parentPath` from path prefixes within the set: a
/// worktree nested under another links to the nearest (longest-path) strict
/// ancestor among the other worktrees. Pure over the supplied list.
fn derive_parent_paths(worktrees: &mut [WorktreeInfo]) {
    let paths: Vec<String> = worktrees.iter().map(|w| w.path.clone()).collect();
    for wt in worktrees.iter_mut() {
        let mut best: Option<&String> = None;
        for candidate in &paths {
            if candidate == &wt.path {
                continue;
            }
            if is_path_prefix(candidate, &wt.path) {
                // Prefer the nearest ancestor (the longest matching path).
                if best.map_or(true, |b| candidate.len() > b.len()) {
                    best = Some(candidate);
                }
            }
        }
        wt.parent_path = best.cloned();
    }
}

/// Whether `ancestor` is a strict path-prefix ancestor of `child` (component
/// boundaries respected, so `/a/foo` is not an ancestor of `/a/foobar`).
fn is_path_prefix(ancestor: &str, child: &str) -> bool {
    let a = Path::new(ancestor);
    let c = Path::new(child);
    c != a && c.starts_with(a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_primary_branch_and_linked_worktrees() {
        // Two records: a primary on `main`, a linked worktree on `feature`.
        let text = "\
worktree /home/u/repo
HEAD abc123
branch refs/heads/main

worktree /home/u/repo-wt/feature
HEAD def456
branch refs/heads/feature
";
        let wts = parse_porcelain(text);
        assert_eq!(wts.len(), 2);

        assert_eq!(wts[0].path, "/home/u/repo");
        assert_eq!(wts[0].head.as_deref(), Some("abc123"));
        assert_eq!(wts[0].branch.as_deref(), Some("main"));
        assert!(wts[0].is_primary, "first record is the primary worktree");

        assert_eq!(wts[1].path, "/home/u/repo-wt/feature");
        assert_eq!(wts[1].head.as_deref(), Some("def456"));
        assert_eq!(wts[1].branch.as_deref(), Some("feature"));
        assert!(!wts[1].is_primary, "linked worktrees are not primary");
    }

    #[test]
    fn parses_detached_head_as_null_branch() {
        let text = "\
worktree /home/u/repo
HEAD abc123
branch refs/heads/main

worktree /home/u/detached
HEAD deadbeef
detached
";
        let wts = parse_porcelain(text);
        assert_eq!(wts.len(), 2);
        let detached = &wts[1];
        assert_eq!(detached.path, "/home/u/detached");
        assert_eq!(detached.head.as_deref(), Some("deadbeef"));
        assert_eq!(
            detached.branch, None,
            "a detached HEAD record has no branch"
        );
    }

    #[test]
    fn handles_no_trailing_blank_line() {
        // git emits a trailing blank line; tolerate input that omits it.
        let text = "worktree /home/u/repo\nHEAD abc123\nbranch refs/heads/main";
        let wts = parse_porcelain(text);
        assert_eq!(wts.len(), 1);
        assert_eq!(wts[0].branch.as_deref(), Some("main"));
        assert!(wts[0].is_primary);
    }

    #[test]
    fn derives_parent_path_from_nesting() {
        // /home/u/repo is an ancestor of /home/u/repo/wt/feature.
        let mut wts = vec![
            WorktreeInfo {
                path: "/home/u/repo".into(),
                branch: Some("main".into()),
                head: Some("abc".into()),
                is_primary: true,
                parent_path: None,
            },
            WorktreeInfo {
                path: "/home/u/repo/wt/feature".into(),
                branch: Some("feature".into()),
                head: Some("def".into()),
                is_primary: false,
                parent_path: None,
            },
        ];
        derive_parent_paths(&mut wts);
        assert_eq!(wts[0].parent_path, None, "the ancestor has no parent");
        assert_eq!(
            wts[1].parent_path.as_deref(),
            Some("/home/u/repo"),
            "nested worktree links to its ancestor"
        );
    }

    #[test]
    fn derives_nearest_ancestor_when_multiple_match() {
        // /a, /a/b, and /a/b/c: c's parent is the nearest (/a/b), not /a.
        let mut wts = vec![
            WorktreeInfo {
                path: "/a".into(),
                branch: None,
                head: None,
                is_primary: true,
                parent_path: None,
            },
            WorktreeInfo {
                path: "/a/b".into(),
                branch: None,
                head: None,
                is_primary: false,
                parent_path: None,
            },
            WorktreeInfo {
                path: "/a/b/c".into(),
                branch: None,
                head: None,
                is_primary: false,
                parent_path: None,
            },
        ];
        derive_parent_paths(&mut wts);
        assert_eq!(wts[1].parent_path.as_deref(), Some("/a"));
        assert_eq!(
            wts[2].parent_path.as_deref(),
            Some("/a/b"),
            "nearest ancestor wins over a more distant one"
        );
    }

    #[test]
    fn sibling_paths_do_not_link() {
        // /home/u/repo is NOT an ancestor of /home/u/repo-wt (component
        // boundary): a string prefix must not create a false parent.
        let mut wts = vec![
            WorktreeInfo {
                path: "/home/u/repo".into(),
                branch: None,
                head: None,
                is_primary: true,
                parent_path: None,
            },
            WorktreeInfo {
                path: "/home/u/repo-wt".into(),
                branch: None,
                head: None,
                is_primary: false,
                parent_path: None,
            },
        ];
        derive_parent_paths(&mut wts);
        assert_eq!(wts[1].parent_path, None, "sibling path is not nested");
    }

    #[test]
    fn non_repo_yields_empty_list() {
        // A path that is not a git repo must yield an empty list, not an error.
        let wts = list_worktrees("/no/such/path/mechsuit-worktree-xyzzy");
        assert!(wts.is_empty());
    }
}
