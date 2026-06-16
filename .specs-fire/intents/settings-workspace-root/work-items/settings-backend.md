---
id: settings-backend
title: Settings backend — persisted app settings + workspace root default-from-HOME + discover wiring
intent: settings-workspace-root
kind: backend
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T14:10:43Z
---

# Work Item: Settings backend — persisted app settings + workspace root default-from-HOME + discover wiring

## Description

Add a small persisted **settings** store and wire the discovery root to it.

- New `src-tauri/src/settings/` module (mirror `directory/persist.rs`): a JSON
  file `settings.json` in the app data dir holding `{ workspace_root: String }`.
  Read returns the persisted value; a missing/empty file yields the default.
- The **default workspace root is derived at runtime**: `$HOME/dev` (via
  `std::env::var("HOME")`), NOT a hardcoded `/home/ruben/...`. Remove
  `DEFAULT_DISCOVER_ROOT = "/home/ruben/dev"` from `directory/mod.rs`.
- `get_settings` / `set_settings` Tauri commands (camelCase payloads), registered
  in `lib.rs`.
- `discover_directories(root, depth)`: when `root` is `None`, fall back to the
  **configured workspace root** (settings), then to the runtime default.

## Acceptance Criteria

- [ ] `settings.json` round-trips `workspace_root` through a temp data dir (test).
- [ ] With no persisted value, the resolved root is `$HOME/dev` derived at
      runtime (test sets `HOME` and asserts), never a literal `/home/ruben`.
- [ ] `get_settings` returns current settings; `set_settings` persists and is
      reflected by the next `get_settings`.
- [ ] `discover_directories` with no `root` uses the configured root.
- [ ] No literal `/home/ruben/dev` remains in `src-tauri/src`.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes.

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/directory/persist.rs
      reason: JSON-store pattern (read/write, data_dir param, temp-dir tests) to mirror
    - path: src-tauri/src/directory/mod.rs
      reason: holds DEFAULT_DISCOVER_ROOT + discover_directories command to rewire
    - path: src-tauri/src/lib.rs
      reason: register the new module + get_settings/set_settings commands
    - path: src-tauri/src/models.rs
      reason: where shared serde models live (add a Settings model if needed)
  patterns:
    - path: src-tauri/src/directory/persist.rs
      reason: store_path/read/write + #[cfg(test)] TempDir pattern without extra crates
    - path: src-tauri/src/directory/mod.rs
      reason: existing #[tauri::command] signatures + tauri::State usage
  tests:
    - path: src-tauri/src/directory/persist.rs
      reason: in-module temp-dir test pattern to replicate for settings persistence
ownership:
  editable:
    - src-tauri/src/settings/
    - src-tauri/src/directory/mod.rs
    - src-tauri/src/lib.rs
    - src-tauri/src/models.rs

finalize_check: "! git grep -n '/home/ruben/dev' -- src-tauri/src"

## Technical Notes

Keep persistence pure-ish (parameterize by data_dir) so it is testable without a
Tauri `AppHandle`, exactly like `persist.rs`. Resolve the app data dir in the
command layer (as the directory commands already do).

## Dependencies

(none)
