---
id: usage-backend
title: Usage backend — OAuth-token usage fetch, get_usage command, 60s poller + usage://updated event
intent: usage-meter
kind: backend
complexity: high
mode: autopilot
status: completed
depends_on: []
created: 2026-06-16T14:36:19Z
---

# Work Item: Usage backend — OAuth-token usage fetch, get_usage command, 60s poller + usage://updated event

## Description

Add a Rust `usage` module that reads the subscription usage limits and exposes them to the
frontend, plus the background poller that pushes updates.

- New module `src-tauri/src/usage/mod.rs`:
  - **Read the OAuth token fresh on each call** from `~/.claude/.credentials.json`
    (`$HOME`-resolved), extracting `claudeAiOauth.accessToken`. A pure helper
    `parse_access_token(file_contents: &str) -> Result<String, String>` does the extraction so
    it is unit-testable; the file read is a thin wrapper around it.
  - **Fetch** `GET https://api.anthropic.com/api/oauth/usage` with headers
    `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`, using `reqwest` on
    the existing tokio runtime.
  - **Parse** the response body with a pure helper
    `parse_usage(body: &str) -> Result<UsageSnapshot, String>` mapping `five_hour`/`seven_day`
    `{utilization, resets_at}` → `UsageSnapshot { five_hour: UsageWindow, seven_day: UsageWindow }`
    where `UsageWindow { utilization: f64, resets_at: String }`. The `resets_at` RFC3339 string
    is passed through verbatim (no date crate).
  - Structs serialize **camelCase** (`fiveHour`, `sevenDay`, `resetsAt`).
- **Command** `#[tauri::command] async fn get_usage() -> Result<UsageSnapshot, String>` — reads
  the token, fetches, parses; any failure (missing/expired token, non-200, network error,
  bad JSON) is a clear `Err(String)`. Registered in `lib.rs`.
- **Poller:** in `lib.rs` `setup`, spawn a background task (`tauri::async_runtime::spawn`) that
  fetches immediately, then every **60s** (named constant), and emits `usage://updated` with
  payload `UsageUpdate { snapshot: Option<UsageSnapshot>, error: Option<String> }` — `snapshot`
  set on success, `error` set (and `snapshot` None) on failure. Add the `USAGE_UPDATED`
  event-name constant + `UsageUpdate` payload struct to `src-tauri/src/events.rs`.
- **Dependency:** add `reqwest` to `src-tauri/Cargo.toml` as a direct dep with
  `default-features = false, features = ["json", "rustls-tls"]` (reuse the in-tree `0.13.x`).
- **Privacy:** never log the token or the full Authorization header.

## Acceptance Criteria

- [ ] `parse_usage` maps a valid endpoint body to `UsageSnapshot` with both windows; missing
      fields / malformed JSON return `Err(String)`. Unit tests cover valid / missing-field /
      malformed cases.
- [ ] `parse_access_token` extracts `claudeAiOauth.accessToken` from credentials JSON and
      errors cleanly when absent/malformed. Unit tested.
- [ ] `get_usage` is registered and callable; on any I/O/parse failure it returns `Err(String)`
      and never panics.
- [ ] The setup poller emits `usage://updated` immediately and then on a 60s cadence, carrying
      `snapshot` on success or `error` on failure.
- [ ] Payload structs serialize camelCase (`fiveHour`, `sevenDay`, `resetsAt`), matching the
      TS contract in the brief.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes (network/file I/O paths are not
      unit-tested; only the pure parsers are).

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/commander/mod.rs
      reason: pattern for an external-auth call that removes/uses creds, async command + spawn_blocking/off-thread, Result<_,String> error mapping, pure testable helpers (build_args/parse_reply)
    - path: src-tauri/src/lib.rs
      reason: register get_usage in invoke_handler and spawn the poller task in setup (alongside the existing mcp::start)
    - path: src-tauri/src/events.rs
      reason: add USAGE_UPDATED event-name constant + UsageUpdate payload struct; mirror the camelCase serde convention
    - path: src-tauri/Cargo.toml
      reason: add reqwest direct dep with rustls-tls + json features (single-owner)
  patterns:
    - path: src-tauri/src/commander/mod.rs
      reason: async tauri::command + off-thread work + parse helper with #[cfg(test)] tests to mirror
    - path: src-tauri/src/models.rs
      reason: camelCase serde struct convention for IPC payloads
    - path: src-tauri/src/mcp/mod.rs
      reason: how a background server/task is started from lib.rs setup with the AppHandle (emit target)
  tests:
    - path: src-tauri/src/commander/mod.rs
      reason: #[cfg(test)] approach for pure parse/extract helpers without live network/files
ownership:
  editable:
    - src-tauri/src/usage/
    - src-tauri/src/events.rs
    - src-tauri/src/lib.rs
    - src-tauri/Cargo.toml

## Technical Notes

High-complexity: new module + new TLS-enabled dependency + async poller task + a new IPC
event/command pair. Keep the pure parsers (`parse_usage`, `parse_access_token`) fully separable
from the I/O so the test suite never touches the network or the real credentials file. The
emit target is the `AppHandle` from `setup` (see how `mcp::start` receives it). `utilization`
is a 0–100 float; pass it through unrounded (the UI rounds for display). Resolve `$HOME` rather
than hard-coding `/home/ruben`.

## Dependencies

(none)
