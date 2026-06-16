---
id: directory-backend
title: Directory backend — add/list/remove, git branch detection, persistence
intent: foundation-terminal-grid
kind: api
complexity: medium
mode: autopilot
status: pending
depends_on: [rust-ipc-contract]
created: 2026-06-16T04:45:28Z
---

# Work Item: Directory backend — add/list/remove, git branch detection, persistence

## Description

Implement the directory module command bodies: add a directory (validate it exists, derive a
display name, detect git repo + current branch), list directories with branch info refreshed
at call time, remove a directory, and persist the directory list across app restarts. Git
detection uses `std::process::Command` (`git -C <path> rev-parse --is-inside-work-tree` and
`--abbrev-ref HEAD`). Persistence is a JSON file in the Tauri app data dir.

## Acceptance Criteria

- [ ] `add_directory(path)` returns `Err` for a nonexistent path; otherwise returns `DirectoryInfo` with `name` = last path segment, `is_git_repo` + `branch` detected, and persists it (dedup by path).
- [ ] `list_directories()` returns persisted directories with `branch` re-evaluated at call time.
- [ ] `remove_directory(path)` removes the entry from persistence.
- [ ] Non-git directory → `is_git_repo = false`, `branch = None`. Detached HEAD handled gracefully (short SHA or `None`, not an error).
- [ ] Persistence survives a process restart (writes to the app data dir via the Tauri v2 path API).
- [ ] `cargo test` covers git detection and persistence using temporary directories.

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/directory/mod.rs
      reason: stub command fns from rust-ipc-contract to implement
    - path: src-tauri/src/models.rs
      reason: DirectoryInfo shape to populate
  patterns:
    - path: src-tauri/src/lib.rs
      reason: command registration + AppHandle/path-API usage pattern
    - path: src-tauri/src/events.rs
      reason: module/serde style reference from rust-ipc-contract
  tests:
    - path: src-tauri/src/directory/mod.rs
      reason: `#[cfg(test)]` tests run via `cargo test`
ownership:
  editable:
    - src-tauri/src/directory/mod.rs
    - src-tauri/src/directory/persist.rs

## Technical Notes

Use the Tauri v2 `app.path().app_data_dir()` for the persistence file (e.g.
`directories.json`). Detect git and branch via `std::process::Command` (no `git2` crate, so
`Cargo.toml` stays single-owner under project-init). Handle non-UTF8/odd paths defensively.
This item fills the `directory/mod.rs` stub created by `rust-ipc-contract` (overlap is
serialized via `depends_on`) and does NOT touch `lib.rs`. Disjoint from `pty-backend`.

## Dependencies

- rust-ipc-contract
