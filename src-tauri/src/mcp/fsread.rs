//! Read-only, managed-directory-scoped filesystem access for Commander.
//!
//! Commander reaches mechsuit only through MCP tools — it has no ambient file
//! access. These helpers let it read a managed project's on-disk artifacts (most
//! importantly the INFERNO run state under `.specs-inferno/`, plus briefs, work
//! items, and logs) WITHOUT a bespoke per-format parser. The tradeoff for that
//! flexibility is surface area, so every path is resolved relative to a resolved
//! managed directory and canonicalized; anything escaping that directory (an
//! absolute path, a `../` climb, or a symlink pointing out) is refused, and
//! reads/walks are bounded.
//!
//! All functions take an already-resolved managed directory `base` (the MCP tool
//! resolves the caller's project query to it via `match_project`) and a path
//! RELATIVE to that base.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Max bytes returned by [`read_file`]; larger files return their tail.
pub const MAX_READ_BYTES: usize = 256 * 1024;
/// Max entries returned by [`list_dir`].
pub const MAX_DIR_ENTRIES: usize = 1000;
/// Max matching lines returned by [`grep_files`].
pub const MAX_GREP_MATCHES: usize = 500;
/// Max files [`grep_files`] will open before stopping.
pub const MAX_GREP_FILES: usize = 5000;
/// Max directory depth [`grep_files`] descends.
pub const GREP_MAX_DEPTH: usize = 8;
/// Max characters of a matching line returned by [`grep_files`].
const GREP_LINE_CAP: usize = 400;
/// Directory names skipped by [`grep_files`] (noise / huge / not source).
const GREP_SKIP_DIRS: [&str; 4] = [".git", "node_modules", "target", "dist"];

/// A directory entry returned by [`list_dir`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    /// File size in bytes; `None` for directories.
    pub size: Option<u64>,
}

/// A single matching line returned by [`grep_files`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    /// Path of the match, relative to the searched root.
    pub path: String,
    /// 1-based line number.
    pub line: usize,
    pub text: String,
}

/// Resolve `relative` against the managed `base`, refusing any path that escapes
/// it. Returns the canonical target on success. The target must exist (it is
/// canonicalized); callers handle the not-found error message.
pub fn safe_join(base: &str, relative: &str) -> Result<PathBuf, String> {
    let base_canon = std::fs::canonicalize(base)
        .map_err(|e| format!("cannot access project directory {base}: {e}"))?;

    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err("path must be relative to the project directory".to_string());
    }

    let target = std::fs::canonicalize(base_canon.join(rel))
        .map_err(|_| format!("no such path: {relative}"))?;
    if !target.starts_with(&base_canon) {
        return Err(format!("path escapes the project directory: {relative}"));
    }
    Ok(target)
}

/// The base directory itself, canonicalized — the root for an empty/omitted
/// relative path in [`list_dir`] / [`grep_files`].
fn base_root(base: &str) -> Result<PathBuf, String> {
    std::fs::canonicalize(base)
        .map_err(|e| format!("cannot access project directory {base}: {e}"))
}

/// Read a file within the managed `base`. Returns its contents (the tail when
/// the file exceeds `last_bytes`, itself capped at [`MAX_READ_BYTES`]).
pub fn read_file(base: &str, relative: &str, last_bytes: Option<usize>) -> Result<String, String> {
    let target = safe_join(base, relative)?;
    if target.is_dir() {
        return Err(format!("{relative} is a directory; use list_dir"));
    }
    let bytes = std::fs::read(&target).map_err(|e| format!("read failed: {e}"))?;
    let cap = last_bytes.unwrap_or(MAX_READ_BYTES).min(MAX_READ_BYTES);
    let start = bytes.len().saturating_sub(cap);
    Ok(String::from_utf8_lossy(&bytes[start..]).into_owned())
}

/// List the entries of a directory within the managed `base` (the base root when
/// `relative` is omitted/empty), sorted by name and bounded.
pub fn list_dir(base: &str, relative: Option<&str>) -> Result<Vec<DirEntry>, String> {
    let target = match relative {
        Some(r) if !r.is_empty() => safe_join(base, r)?,
        _ => base_root(base)?,
    };
    if !target.is_dir() {
        return Err("not a directory".to_string());
    }

    let mut out = Vec::new();
    for entry in std::fs::read_dir(&target).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: file_type.is_dir(),
            size: file_type
                .is_file()
                .then(|| entry.metadata().ok().map(|m| m.len()))
                .flatten(),
        });
        if out.len() >= MAX_DIR_ENTRIES {
            break;
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Case-insensitive literal substring search across files under the managed
/// `base` (or a `subpath` within it). Skips symlinks, binary files, and the
/// noise dirs in [`GREP_SKIP_DIRS`]; bounded by depth, files opened, and matches
/// returned. Literal (not regex) by design to stay dependency-free and cheap.
pub fn grep_files(base: &str, pattern: &str, subpath: Option<&str>) -> Result<Vec<GrepMatch>, String> {
    if pattern.is_empty() {
        return Err("pattern must not be empty".to_string());
    }
    let root = match subpath {
        Some(s) if !s.is_empty() => safe_join(base, s)?,
        _ => base_root(base)?,
    };

    let needle = pattern.to_lowercase();
    let mut matches = Vec::new();
    let mut files_opened = 0usize;
    let mut stack = vec![(root.clone(), 0usize)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > GREP_MAX_DEPTH {
            continue;
        }
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            // Skip symlinks outright: avoids escaping the scope and walk cycles.
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                let name = entry.file_name();
                if GREP_SKIP_DIRS.contains(&name.to_string_lossy().as_ref()) {
                    continue;
                }
                stack.push((path, depth + 1));
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            files_opened += 1;
            if files_opened > MAX_GREP_FILES {
                return Ok(matches);
            }
            let content = match std::fs::read(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            // Skip binary-ish files: a NUL byte near the start is the signal.
            if content.iter().take(8000).any(|&b| b == 0) {
                continue;
            }
            let text = String::from_utf8_lossy(&content);
            let rel = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().into_owned();
            for (i, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    matches.push(GrepMatch {
                        path: rel.clone(),
                        line: i + 1,
                        text: line.trim_end().chars().take(GREP_LINE_CAP).collect(),
                    });
                    if matches.len() >= MAX_GREP_MATCHES {
                        return Ok(matches);
                    }
                }
            }
        }
    }
    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway directory tree under the OS temp dir, removed on drop.
    /// Mirrors the helper style in `persist.rs` to avoid a `tempfile` dep.
    struct TempTree {
        root: PathBuf,
    }

    impl TempTree {
        fn new(tag: &str) -> Self {
            let unique = format!(
                "mechsuit-fsread-{tag}-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let root = std::env::temp_dir().join(unique);
            std::fs::create_dir_all(&root).unwrap();
            TempTree { root }
        }
        fn write(&self, rel: &str, contents: &str) {
            let path = self.root.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, contents).unwrap();
        }
        fn base(&self) -> String {
            self.root.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn reads_a_scoped_file() {
        let tree = TempTree::new("read");
        tree.write(".specs-inferno/state.yaml", "version: 1\nstatus: in_progress\n");
        let out = read_file(&tree.base(), ".specs-inferno/state.yaml", None).unwrap();
        assert!(out.contains("in_progress"));
    }

    #[test]
    fn refuses_paths_that_escape_the_base() {
        let tree = TempTree::new("escape");
        tree.write("inside.txt", "ok");
        // Climbing out is refused...
        assert!(read_file(&tree.base(), "../etc/passwd", None).is_err());
        // ...as is an absolute path.
        assert!(read_file(&tree.base(), "/etc/passwd", None).is_err());
        // A normal in-scope read still works.
        assert_eq!(read_file(&tree.base(), "inside.txt", None).unwrap(), "ok");
    }

    #[test]
    fn lists_a_directory_sorted() {
        let tree = TempTree::new("list");
        tree.write("b.txt", "b");
        tree.write("a.txt", "aa");
        tree.write("sub/c.txt", "c");
        let entries = list_dir(&tree.base(), None).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a.txt", "b.txt", "sub"]);
        let a = entries.iter().find(|e| e.name == "a.txt").unwrap();
        assert_eq!(a.size, Some(2));
        assert!(!a.is_dir);
        assert!(entries.iter().find(|e| e.name == "sub").unwrap().is_dir);
    }

    #[test]
    fn greps_recursively_with_bounds_and_skips() {
        let tree = TempTree::new("grep");
        tree.write("a.md", "alpha\nNEEDLE here\nomega");
        tree.write("sub/b.md", "second needle line");
        tree.write("node_modules/skip.md", "needle should be skipped");
        let hits = grep_files(&tree.base(), "needle", None).unwrap();
        let paths: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
        // Case-insensitive match in both real files; node_modules skipped.
        assert!(hits.iter().any(|h| h.path == "a.md" && h.line == 2));
        assert!(paths.iter().any(|p| p.ends_with("b.md")));
        assert!(!paths.iter().any(|p| p.contains("node_modules")));
        // Empty pattern is rejected.
        assert!(grep_files(&tree.base(), "", None).is_err());
    }
}
