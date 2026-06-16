---
id: commander-claude-driver
title: Commander Claude driver — spawn headless claude (no API key) wired to the MCP server
intent: commander-supervisor-agent
kind: behavior
complexity: high
mode: autopilot
status: pending
depends_on: [mechsuit-mcp-server]
created: 2026-06-16T06:17:01Z
---

# Work Item: Commander Claude driver — spawn headless claude (no API key) wired to the MCP server

# Guard against a key sneaking in: the driver must reuse subscription auth, not set a key.
finalize_check: "! git grep -nE 'ANTHROPIC_API_KEY\\s*=|sk-ant-' -- src-tauri/src/commander"

## Description

Run Commander as a **headless `claude` process** that reuses the user's existing login (no API
key) and reaches mechsuit through the MCP server. New Rust module `src-tauri/src/commander/`,
exposed as a Tauri command, with a thin TS surface.

- Spawn `claude -p <message>` with:
  - **`.env_remove("ANTHROPIC_API_KEY")`** and **no `--bare`**, so it inherits the stored
    subscription OAuth (no key in mechsuit).
  - **`--mcp-config`** pointing at the running MCP server's `http://127.0.0.1:<port>/...` (from
    `mechsuit-mcp-server`), with mechsuit's tools **pre-allowed** for a non-interactive run
    (e.g. `--allowedTools "mcp__mechsuit__*"` + the appropriate permission mode — verify flag
    names against the installed `claude`).
  - **`--append-system-prompt`** carrying the **concise persona**: yes/no when possible; fewest
    words; elaborate only when explicitly asked, then ≤ ~10 sentences, markdown. Include guidance
    that passive status reads come from `read_session_output`; only inject via `send_to_session`
    when the user explicitly asks to "ask" a session, then re-read until the reply settles.
  - **`--output-format json`** to capture the reply text and `session_id`.
- **Multi-turn:** keep the conversation's `session_id`; pass **`--resume <session_id>`** on
  subsequent turns. Surface it so the overlay can keep one conversation going.
- Expose Tauri command **`commander_send(message: String, session_id: Option<String>)
  -> Result<{ reply: String, sessionId: String }, String>`**; register in `lib.rs`.
- TS surface: add `commanderSend(message, sessionId?)` to `src/ipc/commands.ts`, and define
  `src/lib/commander/types.ts` (`CommanderMessage`, and a `CommanderEngine` interface, e.g.
  `ask(message, sessionId?) => Promise<{reply, sessionId}>`) implemented over the command — the
  overlay codes against this interface.

## Acceptance Criteria

- [ ] `commander_send` spawns `claude -p` with `ANTHROPIC_API_KEY` removed and without `--bare`
      (subscription auth; no key configured anywhere).
- [ ] The spawn includes `--mcp-config` for the local MCP server with mechsuit's tools pre-allowed
      (non-interactive), `--append-system-prompt` with the concise persona, and
      `--output-format json`.
- [ ] First turn returns `{ reply, sessionId }`; passing that `sessionId` back issues
      `--resume <id>` and continues the same conversation.
- [ ] A non-zero / error exit from `claude` returns a clear `Err(String)` (surfaced to the UI).
- [ ] No API key is set or stored (see `finalize_check`).
- [ ] `commanderSend` exists in `src/ipc/commands.ts`; `src/lib/commander/types.ts` exports the
      `CommanderEngine` interface + `CommanderMessage`.
- [ ] A Rust test asserts the spawned command line: `ANTHROPIC_API_KEY` removed, no `--bare`,
      and the expected flags present (build the argv via a testable helper rather than asserting a
      real child process).

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/mcp/
      reason: the MCP server's bound address / config shape the spawn must point --mcp-config at
    - path: src-tauri/src/lib.rs
      reason: register the commander_send command in invoke_handler
    - path: src/ipc/commands.ts
      reason: add the commanderSend invoke wrapper next to the existing ones
    - path: src/types/index.ts
      reason: camelCase IPC type conventions for the command result
  patterns:
    - path: src-tauri/src/pty/mod.rs
      reason: existing #[tauri::command] definition + Result<_, String> error convention
    - path: src/ipc/commands.ts
      reason: existing invoke<T> wrapper style and camelCase args
  tests:
    - path: src-tauri/src/pty/mod.rs
      reason: Rust #[cfg(test)] pattern; test the argv builder helper (no real claude spawn)
ownership:
  editable:
    - src-tauri/src/commander/
    - src-tauri/src/lib.rs
    - src/ipc/commands.ts
    - src/lib/commander/types.ts

## Technical Notes

Confirm exact `claude` flag names against the installed version (`claude --help`) — do not trust
hard-coded names; the persona/MCP/permission flags vary by version. Spawning from Rust keeps env
control (`env_remove`) and process management in one place and next to the MCP server. `lib.rs` is
also edited by `mechsuit-mcp-server`; the dependency chain serializes the two (truthful overlap).
The overlay (`commander-overlay`) depends only on the `CommanderEngine` interface defined here.

## Dependencies

- mechsuit-mcp-server
