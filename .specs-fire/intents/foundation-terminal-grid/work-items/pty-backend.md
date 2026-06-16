---
id: pty-backend
title: PTY backend — spawn/stream/write/resize/kill, per-directory session registry
intent: foundation-terminal-grid
kind: api
complexity: high
mode: autopilot
status: pending
depends_on: [rust-ipc-contract]
created: 2026-06-16T04:45:28Z
---

# Work Item: PTY backend — spawn/stream/write/resize/kill, per-directory session registry

## Description

Implement the PTY session module using `portable-pty`: spawn a real PTY rooted at a directory
running the user's default shell, stream output to the frontend via `session://output`
events, accept input via `write_session`, support `resize_session`, terminate via
`kill_session`, and track live sessions in the shared `SessionRegistry` so
`list_sessions(dir_path)` returns a directory's sessions. Emit `session://exit` when a child
exits. Sessions persist in the registry across directory switches (kept alive until killed).

## Acceptance Criteria

- [ ] `spawn_session(dir_path)` spawns a PTY (default shell — `$SHELL` or `/bin/bash`) with cwd = `dir_path`, returns `SessionInfo` with a unique `uuid` id, and registers it.
- [ ] A background reader streams PTY output as `session://output { sessionId, data }` events to the frontend.
- [ ] `write_session(id, data)` writes bytes to the PTY master (input round-trips / echoes verifiably).
- [ ] `resize_session(id, cols, rows)` resizes the PTY.
- [ ] `kill_session(id)` terminates the child and removes it from the registry; `session://exit { sessionId, code }` emitted on natural or forced exit.
- [ ] `list_sessions(dir_path)` returns all live sessions for that directory.
- [ ] The registry is shared safely across commands/threads (Tauri managed `SessionRegistry` + `Mutex`).
- [ ] `cargo test` covers a spawn → write → read round-trip and registry add/remove.

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/pty/mod.rs
      reason: stub command fns from rust-ipc-contract to implement
    - path: src-tauri/src/pty/registry.rs
      reason: SessionRegistry skeleton from rust-ipc-contract to fill with behavior
    - path: src-tauri/src/events.rs
      reason: event names + payload structs to emit
  patterns:
    - path: src-tauri/src/lib.rs
      reason: managed-state (.manage) + command registration pattern
    - path: src-tauri/Cargo.toml
      reason: portable-pty + uuid deps declared by project-init
  tests:
    - path: src-tauri/src/pty/mod.rs
      reason: `#[cfg(test)]` spawn/write/read round-trip via `cargo test`
ownership:
  editable:
    - src-tauri/src/pty/mod.rs
    - src-tauri/src/pty/registry.rs

## Technical Notes

Use `portable-pty` for the PTY pair; spawn a long-lived reader thread per session that emits
output events via the `AppHandle`. Store `Box<dyn MasterPty>` / child handles in the
`SessionRegistry` behind a `Mutex`. This item fills the `pty/mod.rs` + `pty/registry.rs`
stubs from `rust-ipc-contract` (overlap serialized via `depends_on`) and does NOT touch
`lib.rs` (the `.manage()` wiring already lives in `rust-ipc-contract`). Disjoint from
`directory-backend`. Highest-risk item in the intent — the PTY round-trip is the core proof.

## Dependencies

- rust-ipc-contract
