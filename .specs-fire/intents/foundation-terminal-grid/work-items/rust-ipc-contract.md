---
id: rust-ipc-contract
title: Rust IPC contract — command surface, models, events, PTY registry wiring
intent: foundation-terminal-grid
kind: architecture
complexity: medium
mode: autopilot
status: pending
depends_on: [project-init]
created: 2026-06-16T04:45:28Z
---

# Work Item: Rust IPC contract — command surface, models, events, PTY registry wiring

## Description

Establish the Rust side of the IPC contract so the two backend implementation items
(`directory-backend`, `pty-backend`) build in parallel against fixed signatures. Define the
shared serde models, the event-name constants and payload structs, register the full Tauri
command surface in `lib.rs`, and create stub command functions that compile. Also define a
`SessionRegistry` skeleton and `.manage()` it in `lib.rs` so the PTY backend never needs to
touch `lib.rs` (keeps `lib.rs` single-owner).

## Acceptance Criteria

- [ ] `src-tauri/src/models.rs` defines serde structs (with `#[serde(rename_all = "camelCase")]`): `DirectoryInfo { path: String, name: String, is_git_repo: bool, branch: Option<String> }` and `SessionInfo { id: String, dir_path: String }`.
- [ ] `src-tauri/src/events.rs` defines string constants `SESSION_OUTPUT = "session://output"` and `SESSION_EXIT = "session://exit"`, plus camelCase payload structs `OutputEvent { session_id, data }` and `ExitEvent { session_id, code }`.
- [ ] `src-tauri/src/directory/mod.rs` declares stub `#[tauri::command]` fns: `add_directory(path: String) -> Result<DirectoryInfo, String>`, `list_directories() -> Result<Vec<DirectoryInfo>, String>`, `remove_directory(path: String) -> Result<(), String>` (return `Err(...)` placeholders — no panic at registration).
- [ ] `src-tauri/src/pty/mod.rs` declares stub `#[tauri::command]` fns: `spawn_session(dir_path: String, app: tauri::AppHandle, registry: tauri::State<SessionRegistry>) -> Result<SessionInfo, String>`, `write_session(session_id, data) -> Result<(), String>`, `resize_session(session_id, cols: u16, rows: u16) -> Result<(), String>`, `kill_session(session_id) -> Result<(), String>`, `list_sessions(dir_path) -> Result<Vec<SessionInfo>, String>`.
- [ ] `src-tauri/src/pty/registry.rs` defines a `SessionRegistry` (e.g. `Mutex<HashMap<String, ...>>`) with `Default`, registered via `.manage(SessionRegistry::default())` in `lib.rs`.
- [ ] `lib.rs` declares `mod models; mod events; mod directory; mod pty;` and registers all 8 commands in `tauri::generate_handler![...]`.
- [ ] `cargo build` and `cargo test` succeed (the full stub surface compiles and the handler builds).

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/lib.rs
      reason: minimal builder from project-init; this item adds handler, mods, and managed state
    - path: .specs-fire/intents/foundation-terminal-grid/brief.md
      reason: the IPC contract (command/event/type names) is documented in the brief and plan
  patterns:
    - path: src-tauri/src/main.rs
      reason: entrypoint/run() convention established by project-init
    - path: src-tauri/Cargo.toml
      reason: available deps (tauri, serde) declared by project-init
  tests:
    - path: src-tauri/src/lib.rs
      reason: `cargo test` compiles the stub surface and verifies the handler builds
ownership:
  editable:
    - src-tauri/src/lib.rs
    - src-tauri/src/models.rs
    - src-tauri/src/events.rs
    - src-tauri/src/directory/mod.rs
    - src-tauri/src/pty/mod.rs
    - src-tauri/src/pty/registry.rs

## Technical Notes

This item OWNS the command/event contract; the TS mirror lives in `ts-ipc-contract` and the
camelCase field names must match the serde `rename_all`. `directory-backend` fills
`directory/mod.rs`; `pty-backend` fills `pty/mod.rs` + `pty/registry.rs`. Both depend on this
item, so the orchestrator serializes the stub→fill overlap on those module files. `lib.rs`
stays exclusively owned here. Stubs should return `Err("unimplemented".into())` rather than
`unimplemented!()` so `cargo test` does not panic at registration.

## Dependencies

- project-init
