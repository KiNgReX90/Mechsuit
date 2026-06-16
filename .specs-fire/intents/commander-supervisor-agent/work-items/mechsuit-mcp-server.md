---
id: mechsuit-mcp-server
title: mechsuit MCP server — local HTTP server exposing session tools to Commander
intent: commander-supervisor-agent
kind: api
complexity: high
mode: autopilot
status: pending
depends_on: [session-output-buffer]
created: 2026-06-16T06:17:01Z
---

# Work Item: mechsuit MCP server — local HTTP server exposing session tools to Commander

## Description

Host a **local MCP server inside the Tauri process** so a spawned headless `claude` (the
`commander-claude-driver`) can reach mechsuit's capabilities. New Rust module `src-tauri/src/mcp/`.

- Serve MCP over **streamable-HTTP bound to `127.0.0.1`** on an OS-assigned free port (stdio is
  not viable — mechsuit is the host, not a subprocess). Expose the bound `SocketAddr` so the
  driver can build its `--mcp-config`.
- Expose four tools, backed by existing managed state (no new persistence):
  - **`resolve_project(query)`** → the managed directory whose `name` or `branch` matches
    (case-insensitive, exact-then-substring), or null. On a match, **emit a `commander://navigate`
    Tauri event** (payload: directory path) via the `AppHandle` so the UI selects that directory.
  - **`list_sessions(dirPath)`** → the directory's active sessions (reuse the existing
    `list_sessions` logic over `SessionRegistry`).
  - **`read_session_output(sessionId, lastBytes?)`** → `SessionRegistry::recent_output(...)`.
  - **`send_to_session(sessionId, text)`** → write `text` to that session's PTY (reuse the
    `write_session` path: lock the registry, `handle.write(text.as_bytes())`).
- Start the server in `lib.rs` `run()` with shared handles to `SessionRegistry`, the directory
  list, and the `AppHandle`. Add the `commander://navigate` event name to `events.rs`.
- Add the MCP/HTTP/async crates to `Cargo.toml` (current Rust MCP SDK + an HTTP server + tokio as
  needed). Bind localhost-only; optionally require a bearer token the driver passes back.

## Acceptance Criteria

- [ ] An MCP server starts with the app, bound to `127.0.0.1` on a free port; the bound address is
      retrievable for the driver's `--mcp-config`.
- [ ] All four tools are registered and respond per the MCP protocol, backed by the live
      `SessionRegistry` + directory list.
- [ ] `resolve_project` matches by name or branch (case-insensitive, exact preferred over
      substring), returns null on no match, and emits `commander://navigate` with the directory
      path on a match.
- [ ] `read_session_output` returns the session's recent scrollback; `send_to_session` writes the
      given text to the session's PTY; both return a clear MCP error for an unknown session id.
- [ ] The server binds localhost-only (not reachable off-host).
- [ ] A Rust test covers tool dispatch against an in-memory registry/directory fixture:
      resolve (name + branch + miss), read_session_output tail, and send_to_session writing bytes.

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/pty/registry.rs
      reason: SessionRegistry + recent_output accessor (from session-output-buffer) and write path
    - path: src-tauri/src/pty/mod.rs
      reason: existing list_sessions / write_session logic to reuse for the tools
    - path: src-tauri/src/directory/
      reason: managed directory list (name + branch) backing resolve_project
    - path: src-tauri/src/lib.rs
      reason: start the MCP server in run() with shared state + AppHandle
    - path: src-tauri/src/events.rs
      reason: add the commander://navigate event constant
    - path: src-tauri/Cargo.toml
      reason: add the MCP SDK + HTTP server + async runtime dependencies
  patterns:
    - path: src-tauri/src/pty/mod.rs
      reason: how commands lock the registry and shape SessionInfo / error strings
    - path: src-tauri/src/events.rs
      reason: existing event-constant + emit pattern to follow for commander://navigate
  tests:
    - path: src-tauri/src/pty/mod.rs
      reason: Rust #[cfg(test)] style + building a registry fixture to assert tool behavior
ownership:
  editable:
    - src-tauri/src/mcp/
    - src-tauri/src/lib.rs
    - src-tauri/src/events.rs
    - src-tauri/Cargo.toml

## Technical Notes

Consult `claude-code-guide` / the MCP docs for the streamable-HTTP `--mcp-config` shape the driver
must produce; this server must match it. Confirm the current Rust MCP SDK crate before coding. The
server shares managed state with the Tauri commands — pass `Arc` clones (and the `AppHandle`) into
the server task at startup; do not duplicate the registry. `src-tauri/src/lib.rs` is also edited by
`commander-claude-driver` (to register its command); the two are in a dependency chain so the
orchestrator serializes them — overlap is expected and truthful.

## Dependencies

- session-output-buffer
