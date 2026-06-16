---
id: session-quick-actions
title: Session Quick Actions — per-CLI Clear / Compact buttons
status: pending
created: 2026-06-16T05:01:06Z
---

# Intent: Session Quick Actions — per-CLI Clear / Compact buttons

## Goal

Give each session tile its own action buttons — **"Clear"** and **"Compact"** — that inject
the corresponding agent slash-command (`/clear`, `/compact`) followed by Enter into that
session's terminal, so the user runs these common Claude Code maintenance commands with one
click instead of typing them into each session.

## Users

The developer running agent CLIs (primarily Claude Code) across many sessions, who repeatedly
issues `/clear` and `/compact` to keep contexts manageable.

## Problem

`/clear` and `/compact` are frequent, repetitive commands when supervising many agent
sessions; typing them into each terminal by hand is tedious and error-prone. One-click
per-session buttons make it fast and consistent.

## Success Criteria

- Each session tile shows its own action buttons including **"Clear"** and **"Compact"**.
- Clicking **"Clear"** writes `/clear` + Enter to that session via the existing input path
  (`write_session`).
- Clicking **"Compact"** writes `/compact` + Enter to that session.
- Each button acts **only on its own session** (correct session-id routing).
- A tile's button targets **that tile's session even when it is not the focused** one.

## Constraints

- Builds on `foundation-terminal-grid`: uses the existing `write_session` (PTY input) command
  and the per-tile Workspace/Terminal UI. No new backend command is required.
- The slash commands are Claude Code-specific; the buttons are most useful when the session
  runs that CLI (harmless otherwise — they just type text).

## Notes

**Depends on `foundation-terminal-grid` only.** Independent of `session-status-engine` and
`sidebar-status-dots` — can be built in parallel with them once the foundation lands.

Surfaced by the user during follow-on intent capture (2026-06-16).

Decisions resolved at decomposition (2026-06-16, with the user):
- **Buttons are icons, not words** — Clear = refresh icon, Compact = box/package icon.
- **Placement**: inline in the existing per-tile header (and the expanded-view header),
  alongside the expand/collapse control. No overflow menu.
- **Command set is fixed** (`/clear`, `/compact`) for this intent; user-configurable actions
  are deferred to a later intent.
- **Submit sequence is `\r`** — xterm delivers Enter as carriage return and the PTY input
  path forwards raw bytes, so `/clear\r` / `/compact\r`.

Scope expanded by the user: the per-session action group also includes **Expand** (fullscreen
that session — reuses the existing `expandedSessionId` fill-the-workspace mechanism) and
**Close** (kill that session via `killSession` + remove it from `sessionsStore`, clearing
focus/expand state if needed). All four actions (Clear, Compact, Expand, Close) live in one
`SessionActions` icon group rendered in every tile header and the expanded view.
