---
id: foundation-terminal-grid
title: Foundation — Sidebar Navigation & Multi-Terminal Grid Workspace
status: pending
created: 2026-06-16T04:45:28Z
---

# Intent: Foundation — Sidebar Navigation & Multi-Terminal Grid Workspace

## Goal

Lay the architectural base of **mechsuit**: a Tauri desktop app (Rust backend,
React frontend) that lets a user manage many concurrent terminal sessions from a single
screen. This first intent delivers the structural foundation everything else builds on:

- A **left sidebar** of user-added directories, each showing its path and (when the
  directory is a git repo) its current branch underneath in a distinct font color.
- A **workspace view** entered by clicking a directory, showing that directory's active
  sessions with a standard **action bar** (first action: "add terminal").
- **Real PTY sessions** that spawn rooted at the selected directory and typically run an
  interactive **agent CLI** (e.g. Claude Code). Their live output renders in the workspace.
- A **grid tiling layout** that arranges N sessions, weighting the top row on uneven
  counts, plus the ability to **expand/focus** a single session.

Status styling (colored borders, blinking) and sidebar status dots are explicitly
**out of scope** for this intent and are captured as follow-on intents below.

## Users

The developer (initially the repo owner) running and supervising multiple coding-agent
CLI sessions across several project directories at once, who today juggles separate
terminal windows/tabs and wants one consolidated control surface to spawn sessions and
switch between them quickly.

## Problem

Running many concurrent agent/terminal sessions across different repositories means
juggling separate windows, tabs, or multiplexer panes. There is no single screen that
groups sessions by directory, shows each repo's git branch at a glance, and tiles live
sessions together so you can supervise and switch between them fast. This intent builds
the foundation that makes that single-screen control surface possible.

## Success Criteria

- The Tauri app launches showing a **left sidebar** and a **main workspace** area.
- A **`+` button** lets the user add a directory by hand; it appears in the sidebar as a
  button showing the directory path.
- When an added directory is a **git repository**, its **current branch** is shown
  underneath the path in a **different font color**; non-git directories show no branch.
- **Clicking a directory** opens its workspace and shows that directory's sessions; the
  active/selected directory is visually indicated.
- The workspace shows a **standard action bar** whose first action is **"add terminal."**
- Adding a terminal **spawns a real PTY** session rooted at the selected directory; the
  session's live stdout/stderr renders in the workspace and accepts keyboard input.
- Running an interactive agent CLI (e.g. `claude`) inside a spawned session works
  (input/output round-trips correctly through the PTY).
- The **grid tiles** sessions correctly: 1 = full; 4 = even quadrants; uneven counts put
  the extra tile(s) on the **top row** (5 → 3 top / 2 bottom; 9 → 5 top / 4 bottom).
- A user can **expand/focus** one session to fill the workspace and return to the grid.
- **Keyboard input routes to the focused session** only.
- Sessions are tracked **per-directory**, so switching directories in the sidebar
  preserves each directory's running sessions (switching back shows them still alive).

## Constraints

- **Stack:** Tauri (Rust backend + React frontend). Confirmed by the user.
- **Terminals:** real PTYs on the Rust side (e.g. `portable-pty`); terminal rendering on
  the frontend via a terminal emulator component (e.g. xterm.js or equivalent).
- **Platform:** cross-platform capable via Tauri; **Linux is the primary dev target** for
  this intent.
- **Greenfield:** the repository is currently empty (pre-implementation) — this intent
  creates the project scaffold, build system, and base architecture from scratch.
  Confirm the Rust/React/Tauri project conventions during decomposition.
- **Out of scope (deferred to follow-on intents):** session status detection via output
  parsing; colored status borders (cyan focused / blinking green done / orange awaiting
  approval / red error-timeout); per-directory sidebar status dots and their ordering.
  The base only needs to track which session is *focused* (for input routing + expand),
  not derive richer status.

## Notes

**This is the base intent. The user explicitly plans follow-on intents layered on top.**
Decisions captured from intent-capture dialogue (2026-06-16):

- **Session model:** a session = a real PTY terminal that *usually* runs an interactive
  agent CLI; statuses (in later intents) map to the agent lifecycle.
- **Status detection (later):** parse the terminal output stream — agent-agnostic, no
  per-agent integration required.
- **Base scope choice:** the user chose the larger base — scaffold + sidebar +
  multi-terminal grid (tiling + add-terminal + expand/focus) — deferring status styling
  and sidebar dots.

### Planned follow-on intents (roadmap — NOT part of this intent)

These were flagged as separately/parallel-buildable once the foundation lands:

1. **Session status engine** — parse PTY output to derive each session's state
   (working → awaiting approval → done → error/timeout); per-session **border styling**:
   cyan = focused, **blinking green = done that fades after a while until clicked**,
   orange = awaiting approval, red = error/timeout.
2. **Sidebar status aggregation** — per-directory **status dots** (green = ready,
   orange = waiting, red = error) each with a **count inside**, **hidden when count is
   zero**, with priority ordering **error → awaiting → ready** (also drives directory
   sort/attention order).
3. **(Candidate, TBD)** — agent launch profiles / configurable default launch command,
   and session persistence across app restarts.

Open items to settle at decomposition or in follow-on intents:
- Default behavior of "add terminal": spawn the user's shell vs. a configurable
  agent command. (Base assumption: spawn a shell PTY rooted at the directory; the user
  types their agent command. An agent picker is a follow-on.)
- Where the directory list is persisted (config file vs. app state) — likely needed even
  in the base so added directories survive a restart; confirm during decomposition.
