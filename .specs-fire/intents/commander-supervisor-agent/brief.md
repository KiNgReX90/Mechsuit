---
id: commander-supervisor-agent
title: Commander — Central Supervisor Agent
status: pending
created: 2026-06-16T06:17:01Z
---

# Intent: Commander — Central Supervisor Agent

## Goal

Add **Commander**, a single central supervisor agent summoned by a global hotkey
(**Ctrl+Shift+C**), that reports on and relays messages to the live PTY sessions of a project
the user names — addressed by **directory name or git branch**. Commander reads each session's
recent terminal output to summarize what its agent is doing, and can relay messages back into a
specific session, so the user supervises and steers many sessions from one conversational
control point without opening each tile.

Commander runs as a **headless Claude Code process** that reuses the user's existing local
Claude login — **no API key is configured in mechsuit** — and reaches mechsuit's capabilities
through a **local MCP server** mechsuit hosts.

Beyond supervising sessions, Commander can also **manage the workspace itself**: spawned **rooted
at the user's home** (`/home/ruben`) for filesystem reach, it can **discover** git repositories and
directories under a root (default `~/dev`), **add** them as session groups, and **remove** stale
ones — so the user curates the sidebar by conversation as well as by hand. The sidebar additionally
shows how recently each group was edited, to make staleness visible.

## Users

The developer supervising many concurrent agent-CLI sessions across several directories, who
wants one place to ask "how is project X doing?" and to send a quick instruction to a specific
session — without hunting for and switching into that session's tile, and without managing API
credentials.

## Problem

Even with the tiled grid, learning the state of a project's sessions means reading each tile,
and steering an agent means finding and focusing its tile first. Across many sessions and many
directories, that scanning and context-switching is the bottleneck. There is no single place to
ask about a project by name/branch and get a terse status, or to relay one instruction to one
session, without manual navigation.

## Success Criteria

- A global hotkey **Ctrl+Shift+C** toggles a **Commander overlay** (chat window) from anywhere
  in the app; it persists conversation history across opens.
- **No API key:** Commander reuses the user's existing local Claude Code login (subscription
  auth). mechsuit never stores, prompts for, or requires an Anthropic API key.
- The user addresses a project by **directory name OR git branch**; Commander resolves it to the
  managed directory and the UI **navigates the sidebar to that directory** so the user sees the
  scoped context.
- Commander reports a **terse status digest** of that directory's **active sessions**, derived by
  default from each session's **recent terminal output** — running agents are not interrupted.
- Commander is **two-way**: the user can have it **relay a message** to a specific session's agent
  (answer a prompt, say "continue", redirect), delivered to that session's PTY input.
- **Active query** (Commander sends a prompt into a session and waits for the reply) happens
  **only when the user explicitly asks** Commander to ask a session something — never as part of
  the passive digest.
- Commander's answers are **maximally concise**: yes/no when possible; fewest words; it
  **elaborates only when explicitly asked**, and even then **≤ ~10 sentences**, nicely formatted
  (markdown).
- Works with **no structured agent integration** inside the sessions — Commander observes via
  terminal scrollback and relays via PTY input, so it functions for any agent CLI or a plain
  shell.
- **Workspace discovery:** on request, Commander scans a root (default `~/dev`, bounded depth) for
  **git repos and plain directories** and reports candidates with branch, **last-edited**, and
  whether each is **already managed** — skipping `.gitignore`'d / heavy dirs.
- **Add is direct; remove is confirmed:** Commander **adds** a discovered/named directory as a
  session group directly (non-destructive); **removal requires explicit confirmation**, and removing
  a group with **active sessions** warns and only proceeds (killing those sessions) once confirmed.
- **Spawned rooted at the user's home** (`/home/ruben`) so its filesystem reach spans anything the
  user points it at, with `~/dev` the default discovery root.
- Each session group in the sidebar shows a **"edited Xd ago"** relative time (git-aware newest
  working-tree file) and a **stale indicator** past a threshold; the user can also **remove a group
  manually** from the sidebar (same active-session confirmation).

## Constraints

- Builds on **`foundation-terminal-grid`**: reuses the directory list (name + branch), the
  per-directory session registry / `list_sessions`, the `session://output` stream, and PTY input.
- **Mechanism — no API key, Claude Code + MCP** (user decision, 2026-06-16):
  - Commander is a **headless `claude` process** mechsuit spawns (`claude -p`), reusing the user's
    **existing subscription login** — spawned with `ANTHROPIC_API_KEY` unset and **not** `--bare`,
    so it inherits the stored OAuth credentials. No key is held by mechsuit.
  - mechsuit hosts a **local HTTP MCP server** (bound to `127.0.0.1`) exposing the capability tools
    to that process: `resolve_project`, `list_sessions`, `read_session_output`, `send_to_session`,
    plus the workspace tools `discover_projects`, `add_project`, `remove_project`.
    The spawned `claude` is pointed at it via `--mcp-config`, with mechsuit's own tools pre-allowed
    so the run is non-interactive.
  - Persona via `--append-system-prompt`; multi-turn via `--resume <session_id>`; reply captured via
    `--output-format json`.
  - **Why MCP (and why it is required, not optional):** once Commander must be a *separate spawned
    process* (the only no-API-key option), MCP is the only robust way to give that process live
    access back into mechsuit's running registry. A no-MCP alternative — mechsuit pre-gathers
    context and uses `claude` only as a summarizer — would forfeit the agreed agentic two-way
    control. MCP is therefore the minimal mechanism that preserves the scope; nothing beyond it is
    added.
- **One backend capability addition:** a capped **per-session scrollback ring buffer** in the Rust
  `SessionRegistry`, filled by the existing PTY reader thread and read **in-process** by the MCP
  server (output is currently only streamed to the frontend, not retained).
- **Workspace capability additions (kept minimal):**
  - `last_modified` is an **additive field** on `DirectoryInfo`, computed git-aware (newest
    working-tree file mtime, ignored/heavy dirs excluded), re-evaluated per `list` call (not persisted).
  - **Discovery** is a **plain, on-request Rust routine** (`directory::discover`) — bounded depth, no
    background scan, no new crate — consumed by the `discover_projects` MCP tool.
  - **Removal for Commander is server-side** in the `remove_project` MCP tool (it holds the
    `SessionRegistry` + directory store): it computes active-session impact and only kills + removes
    on explicit `confirm`. The **sidebar's manual remove** is a separate path that composes the
    existing `kill_session` + `remove_directory` IPC with an in-UI confirm — no backend command
    signature change.
- **Status source is hybrid:** passive scrollback read by default; active query only on explicit
  user request.
- **Independent of `session-status-engine`** (now completed): Commander works on raw scrollback; it
  may additionally surface that intent's derived status later, but does not require it.
- **Requires the `claude` CLI installed and logged in** on the machine — already true, since the
  user runs Claude Code in sessions.
- **Platform:** Linux primary (consistent with foundation). The global hotkey must register
  app-wide within the Tauri window.

## Notes

Design agreed via brainstorming (2026-06-16); mechanism revised the same day after the user ruled
out API keys. Decisions captured:

- **Name "Commander"** (user choice).
- **Invocation:** global hotkey **Ctrl+Shift+C** → overlay window (user choice).
- **Capability:** read + **two-way relay** (user choice).
- **Status source:** **hybrid** passive/active (user choice).
- **Mechanism:** **no API key** — headless Claude Code (subscription auth) + mechsuit-hosted MCP
  server (user constraint: no API keys; MCP accepted). Supersedes the earlier "built-in tool-loop,
  no MCP" decision, which assumed an in-app API key.

Claude Code mechanics confirmed via `claude-code-guide` (2026-06-16): a non-`--bare` headless
`claude` inherits the stored subscription OAuth (unset `ANTHROPIC_API_KEY` so it is not
overridden); `--mcp-config` supports an **HTTP** transport (suitable for a server hosted inside
mechsuit; stdio is not, since mechsuit is the host); MCP tools can be pre-allowed for
non-interactive headless runs (`--allowedTools` / permission mode); persona via
`--append-system-prompt`; multi-turn via `--resume <session_id>` with the id captured from
`--output-format json`.

Open items to resolve at decomposition:

- Exact `claude` flags to pre-allow mechsuit's MCP tools non-interactively — **verify against the
  installed `claude` version** (`claude --help`); do not hard-code flag names blindly.
- MCP transport crate + binding: streamable-HTTP on `127.0.0.1` ephemeral port; optional bearer
  token; confirm the current Rust MCP SDK crate.
- Reply-complete for active queries is now the agent's concern (it re-reads `read_session_output`
  until stable) — give it guidance in the system prompt rather than hard-coding a timer.
- Which model the spawned `claude` uses (user default vs an explicit `--model`).
- Conversation/session persistence (`--resume` storage) across app restarts.
- **"All projects" digest scope:** whether Commander can report across every managed directory at
  once, not just one named project.
- **Stale threshold:** the sidebar "stale" cutoff is a named constant (default 7 days) for now —
  whether it becomes user-configurable later.
- **Discovery defaults:** default root (`~/dev`) and depth (~2); whether multiple roots / arbitrary
  user-named paths beyond the default are supported from the start.
