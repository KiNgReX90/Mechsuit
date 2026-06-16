---
id: commander-workspace-tools
title: Commander workspace tools — discover/add/remove_project MCP tools + persona & home-rooted spawn
intent: commander-supervisor-agent
kind: api
complexity: high
mode: autopilot
status: pending
depends_on: [mechsuit-mcp-server, commander-claude-driver, workspace-discovery]
created: 2026-06-16T08:53:00Z
---

# Work Item: Commander workspace tools — discover/add/remove_project MCP tools + persona & home-rooted spawn

## Description

Give Commander the ability to manage the workspace itself — find repos/directories, add them as
session groups, and remove stale ones — by extending the **MCP server** with three more tools and
teaching the **persona** how/when to use them. Builds directly on `mechsuit-mcp-server` (tool
host + shared state) and `commander-claude-driver` (spawn + system prompt).

- **Three new MCP tools in `src-tauri/src/mcp/`** (registered + dispatched exactly like the existing
  `resolve_project` / `list_sessions` / `read_session_output` / `send_to_session`):
  - **`discover_projects(root?, depth?)`** → calls
    `crate::directory::discover::discover(root, depth, managed)` (default `root` = the user's
    `~/dev`, default `depth` ~2; `managed` from the persisted directory list) and returns the
    `DiscoveredDir` candidates (repos **and** plain dirs, with `branch`, `lastModified`,
    `alreadyManaged`).
  - **`add_project(path)`** → `directory::persist::add(...)` against the app-data store. **Direct,
    non-destructive.** Returns the added `DirectoryInfo` (and is a no-op dedup if already managed).
  - **`remove_project(query, confirm?)`** → resolve `query` (name | branch | path) to a managed
    directory (reuse the server's `resolve_project` matching), then count that directory's **active
    sessions** from the shared `SessionRegistry` (filter by `dir_path`). If sessions exist and
    `confirm` is not true, return **`{ confirmationRequired: true, activeSessions: N }`** and make no
    change. If `confirm` is true (or there are no active sessions), **kill** those sessions (via the
    registry) and `directory::persist::remove(...)` the entry.
- **Persona + home-rooted spawn in `src-tauri/src/commander/`:**
  - Extend the `--append-system-prompt` persona: Commander may **discover/add directly** but **must
    ask for explicit confirmation before removing**, and must warn when a removal will kill live
    sessions (relay the tool's `confirmationRequired`/`activeSessions`, then re-call `remove_project`
    with `confirm: true` only after the user agrees).
  - Spawn the headless `claude` process with **cwd `/home/ruben`** (the user's home) so its reach
    spans everything the user points it at, with `~/dev` as the default discovery root.

The removal confirmation is **conversational** — handled by the existing chat overlay as ordinary
turns — so **no overlay/UI change** is needed.

## Acceptance Criteria

- [ ] `discover_projects`, `add_project`, `remove_project` are registered on the MCP server and
      respond per the protocol, backed by live shared state (directory store + `SessionRegistry`).
- [ ] `discover_projects` returns `discover(...)` candidates; `root` defaults to the user's `~/dev`
      and `depth` to the bounded default when omitted.
- [ ] `add_project(path)` adds the directory (dedup no-op if present) and returns its info; it makes
      no destructive change.
- [ ] `remove_project` resolves by name/branch/path; with active sessions and no `confirm` it returns
      `confirmationRequired` + `activeSessions` and changes nothing; with `confirm` (or zero active
      sessions) it kills the directory's sessions and removes the entry.
- [ ] The persona instructs: discover/add are direct; remove requires explicit user confirmation and
      a live-session warning; the spawned `claude` runs with cwd `/home/ruben`.
- [ ] A Rust `#[cfg(test)]` test (mirroring `mechsuit-mcp-server`'s in-memory registry/directory
      fixture) covers tool dispatch: discover returns candidates, add persists, remove returns
      `confirmationRequired` when sessions are active and kills+removes when `confirm` is set.
- [ ] No API key is introduced in `src-tauri/src/commander` (the existing driver `finalize_check`
      guard still passes).

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/mcp/
      reason: the MCP server + its tool registration/dispatch pattern to extend with three tools
    - path: src-tauri/src/directory/discover.rs
      reason: the discover() routine backing discover_projects
    - path: src-tauri/src/directory/persist.rs
      reason: persist::add / persist::remove backing add_project / remove_project
    - path: src-tauri/src/pty/registry.rs
      reason: SessionRegistry — count + kill a directory's active sessions in remove_project
    - path: src-tauri/src/commander/
      reason: extend the --append-system-prompt persona and set the spawn cwd to /home/ruben
  patterns:
    - path: src-tauri/src/mcp/
      reason: existing resolve_project/list_sessions/read_session_output/send_to_session tools — shape, dispatch, error strings
    - path: src-tauri/src/pty/mod.rs
      reason: list_sessions (filter by dir_path) + kill_session (kill via registry) patterns to reuse
  tests:
    - path: src-tauri/src/mcp/
      reason: extend the MCP server's #[cfg(test)] tool-dispatch tests with the three new tools
ownership:
  editable:
    - src-tauri/src/mcp/
    - src-tauri/src/commander/

## Technical Notes

This item overlaps `mechsuit-mcp-server` (on `src-tauri/src/mcp/`) and `commander-claude-driver`
(on `src-tauri/src/commander/`); both overlaps are truthful and serialized by `depends_on`, so it
runs after those land and edits established files rather than racing them. Reuse the server's
existing `resolve_project` matching for `remove_project`'s lookup instead of re-implementing it.
`remove_project` must compute impact and act **server-side** (the MCP server already holds the
`SessionRegistry` + directory list + `AppHandle`) — do **not** route through the frontend
`remove_directory` path (that is the sidebar's manual-remove route in `dir-last-modified`). Keep the
confirmation protocol in the tool result so the persona can drive it conversationally with no UI
work.

## Dependencies

- mechsuit-mcp-server
- commander-claude-driver
- workspace-discovery
