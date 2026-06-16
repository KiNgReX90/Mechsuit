---
id: session-output-buffer
title: Session output buffer — capped per-session scrollback + in-process accessor
intent: commander-supervisor-agent
kind: architecture
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T06:17:01Z
---

# Work Item: Session output buffer — capped per-session scrollback + in-process accessor

## Description

The MCP server reads what each session's agent has recently printed. Today PTY output is only
streamed to the frontend via `session://output` and never retained backend-side. Add a **capped
per-session scrollback buffer** and an in-process accessor (no Tauri command / no frontend
wrapper — the MCP server, in the same Rust process, reads it directly).

- In `SessionHandle` (`registry.rs`), add a shared bounded byte buffer
  (`Arc<Mutex<VecDeque<u8>>>`) holding the **most recent ~64 KiB** of output, evicting from the
  front past the cap (ring semantics).
- In the reader thread in `mod.rs` (`spawn_pty`), append each read chunk to that session's
  buffer **in addition to** emitting `session://output` (do not change existing streaming).
- Add `SessionRegistry::recent_output(&self, session_id: &str, last_bytes: Option<usize>)
  -> Option<String>` returning the tail decoded with `String::from_utf8_lossy` (whole buffer when
  `last_bytes` is `None`), or `None` for an unknown session.

Buffer lives on the handle, so it is freed when the session is removed.

## Acceptance Criteria

- [ ] `SessionHandle` holds a bounded output buffer capped at ~64 KiB (named constant); appends
      past the cap evict oldest bytes (never grows unbounded).
- [ ] The reader thread appends every output chunk to the buffer AND still emits
      `session://output` unchanged.
- [ ] `SessionRegistry::recent_output(id, last_bytes)` returns the buffer tail (whole buffer when
      `None`) or `None` for an unknown id.
- [ ] A Rust test (in `pty/mod.rs` `#[cfg(test)]`, via the existing `spawn_pty` harness) drives a
      child that prints known bytes and asserts `recent_output` returns that tail; a cap test
      asserts the buffer stays within the limit under large output.

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/pty/registry.rs
      reason: SessionHandle + SessionRegistry — add the bounded buffer field and recent_output accessor
    - path: src-tauri/src/pty/mod.rs
      reason: spawn_pty reader thread (append to buffer); existing #[cfg(test)] harness to extend
  patterns:
    - path: src-tauri/src/pty/registry.rs
      reason: existing Arc<Mutex<..>> SharedSessions pattern to mirror for the buffer
  tests:
    - path: src-tauri/src/pty/mod.rs
      reason: extend the existing PTY test module (channels + spawn_pty) to cover buffer + accessor
ownership:
  editable:
    - src-tauri/src/pty/registry.rs
    - src-tauri/src/pty/mod.rs

## Technical Notes

The buffer must be readable from the MCP server thread while the reader thread writes it, so wrap
it in `Arc<Mutex<..>>` (a clone goes into the reader thread, like `SharedSessions`). Keep the cap
a named constant. `from_utf8_lossy` is fine — Commander tolerates replacement chars; do not split
on UTF-8 boundaries. This item only adds capability; `mechsuit-mcp-server` consumes
`recent_output`.

## Dependencies

(none)
