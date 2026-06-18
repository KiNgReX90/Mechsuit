---
id: wi-01-worktree-discovery
title: Worktree discovery backend + IPC
intent: sessions-graph
kind: api
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-17
---

# Work Item: Worktree discovery backend + IPC

## Description

Add a backend capability to enumerate git worktrees for a managed repository,
exposed to the frontend. Create a new Rust module `src-tauri/src/worktree/` that
shells out to `git worktree list --porcelain` for a repo path and parses the
output into a `WorktreeInfo` struct: absolute path, branch (nullable for detached
HEAD), HEAD commit, a flag for the primary worktree, and a `parentPath` linking a
worktree nested under another. Register a Tauri command `list_worktrees` in
`lib.rs`, add the camelCase serde `WorktreeInfo` to `models.rs`, the matching TS
type to `src/types/index.ts`, and a `listWorktrees` wrapper to
`src/ipc/commands.ts`. This is the worktree axis of the graph spine; it is
distinct from the subagent axis (INFERNO builders share one intent worktree).

## Acceptance Criteria

- [ ] `list_worktrees` returns the worktrees for a managed repo — the primary worktree plus any linked worktrees — parsed from `git worktree list --porcelain`.
- [ ] Each entry carries absolute path, branch (null when detached), HEAD commit, and an `isPrimary` flag.
- [ ] Nesting is represented: a worktree whose path is under another worktree's path links to it via `parentPath`.
- [ ] Non-git directories or any git failure return an empty list — never an error that breaks the caller.
- [ ] A Rust unit test covers porcelain parsing including a detached HEAD and a linked worktree.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes and `npm run build` typechecks the new TS type + wrapper.

## Execution Manifest

context:
  required:
    - path: src-tauri/src/directory/persist.rs
      reason: existing pattern for shelling out to git via std::process::Command and detecting repo/branch
    - path: src-tauri/src/directory/discover.rs
      reason: pattern for a backend module that inspects git state and returns serde models
    - path: src-tauri/src/lib.rs
      reason: register the new list_worktrees command in tauri::generate_handler!
    - path: src-tauri/src/models.rs
      reason: where camelCase serde structs live; add WorktreeInfo here
    - path: src/ipc/commands.ts
      reason: add the typed listWorktrees invoke wrapper (1:1 with the command)
    - path: src/types/index.ts
      reason: add the WorktreeInfo TS type mirroring the Rust model
  patterns:
    - path: src-tauri/src/directory/persist.rs
      reason: follow how git output is captured and turned into Option/structs
    - path: src/ipc/commands.ts
      reason: follow the existing 1:1 typed-wrapper convention
  tests:
    - path: src-tauri/src/directory/persist.rs
      reason: inline #[cfg(test)] git tests with temp dirs are the convention to mirror for the porcelain parser
    - path: cargo test --manifest-path src-tauri/Cargo.toml
      reason: verification command for the Rust side
ownership:
  editable:
    - src-tauri/src/worktree/
    - src-tauri/src/lib.rs
    - src-tauri/src/models.rs
    - src/ipc/commands.ts
    - src/types/index.ts

## Technical Notes

`git worktree list --porcelain` emits records separated by blank lines, each with
`worktree <path>`, `HEAD <sha>`, and either `branch refs/heads/<name>` or
`detached`. Derive `parentPath` purely from path prefixes among the returned set.
Overlaps wi-02 only on `src/types/index.ts` (both add one TS type) — the
orchestrator serializes that one-file overlap; the Rust worktree module and wi-02's
frontend modules are otherwise fully disjoint.

## Dependencies

(none)
