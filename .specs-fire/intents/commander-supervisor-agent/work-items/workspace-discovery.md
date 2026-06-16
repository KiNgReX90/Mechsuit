---
id: workspace-discovery
title: Workspace discovery — git-aware bounded walk for candidate session groups
intent: commander-supervisor-agent
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: [dir-last-modified]
created: 2026-06-16T08:53:00Z
---

# Work Item: Workspace discovery — git-aware bounded walk for candidate session groups

## Description

A reusable backend routine that scans a root for candidate session groups, so Commander can answer
"find my repos under ~/dev". Implemented as a **plain, unit-tested Rust function** (no Tauri
command yet) — the MCP `discover_projects` tool (`commander-workspace-tools`) is its consumer.

- New module **`src-tauri/src/directory/discover.rs`** with
  `pub fn discover(root: &str, max_depth: usize, managed: &[String]) -> Vec<DiscoveredDir>`:
  - Walks `root` to **bounded depth** (default depth ~2 chosen by the caller), collecting both
    **git repositories and plain directories** as candidates.
  - **Skips** heavy/ignored dirs (`.git`, `node_modules`, `target`, `dist`, and dot-dirs) so the
    walk stays cheap; does not descend into a repo's children once the repo itself is recorded.
  - For each candidate, reuses `super::persist::detect_git` (→ `is_git_repo`, `branch`) and
    `super::persist::detect_last_modified` (→ `last_modified`), and sets `already_managed` by
    comparing the candidate path against `managed` (the persisted directory paths).
- Define **`DiscoveredDir`** here (serde `camelCase`): `path, name, is_git_repo, branch,
  last_modified, already_managed`. Defined locally (not in `models.rs`) since it is discovery-specific
  and crosses only the MCP boundary.
- Declare the module: add `mod discover;` to `directory/mod.rs` (and a `pub use` if convenient). No
  command registration and no `lib.rs` change in this item.

## Acceptance Criteria

- [ ] `discover(root, max_depth, managed)` returns candidates for **both** git repos and plain dirs
      under `root`, honoring `max_depth` and skipping `.git`/`node_modules`/`target`/`dist`/dot-dirs.
- [ ] Each `DiscoveredDir` has correct `is_git_repo`/`branch` (via `detect_git`), `last_modified`
      (via `detect_last_modified`), and `already_managed` set true exactly for paths present in
      `managed`.
- [ ] A discovered git repo is recorded as a candidate and its internals are not descended into.
- [ ] `DiscoveredDir` serializes camelCase, matching the TS conventions in `models.rs`.
- [ ] A Rust `#[cfg(test)]` test builds a temp tree (a nested repo, a plain dir, and a
      `node_modules`/dot-dir to ignore), then asserts: repos + dirs found, ignored dirs skipped,
      `max_depth` respected, and `already_managed` reflects the supplied list. (Mirror the temp-dir +
      `init_repo` git-helper style from `directory/persist.rs`.)

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/directory/persist.rs
      reason: reuse detect_git + detect_last_modified; read managed paths shape for already_managed
    - path: src-tauri/src/directory/mod.rs
      reason: declare `mod discover;` (the module lives under the directory module)
    - path: src-tauri/src/models.rs
      reason: DirectoryInfo's camelCase serde conventions to mirror for DiscoveredDir (not edited)
  patterns:
    - path: src-tauri/src/directory/persist.rs
      reason: pure-fn-parameterized-by-path + #[cfg(test)] TempDir/init_repo harness to mirror
  tests:
    - path: src-tauri/src/directory/discover.rs
      reason: in-module #[cfg(test)] covering walk depth, ignore rules, git/last-modified, already_managed
ownership:
  editable:
    - src-tauri/src/directory/discover.rs
    - src-tauri/src/directory/mod.rs

## Technical Notes

`discover.rs` reaches its sibling via `super::persist::detect_git` / `detect_last_modified` —
`detect_last_modified` is made `pub` by `dir-last-modified` (the dependency), and `detect_git` is
already `pub`; sibling submodules of `directory` can use each other's `pub` items. Keep the walk
allocation-light and depth-bounded; this runs on demand from Commander, not on a timer, so a plain
recursive `std::fs::read_dir` with an ignore set is sufficient — no new crate. The caller (the MCP
tool) supplies `root` (Commander defaults it to the user's `~/dev`) and `managed` (the persisted
list); this function stays free of app state so it is trivially testable.

## Dependencies

- dir-last-modified
