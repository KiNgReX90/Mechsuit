---
id: sessions-graph
title: Live Sessions Graph — Mission Control
status: pending
created: 2026-06-17
---

# Intent: Live Sessions Graph — Mission Control

## Goal

Add a new full-window "mission control" screen, opened from a button in the top
bar, that visualizes ALL live work across every managed directory as a single
pan/zoom node graph. The graph is a full tree, always expanded:

```
repo (main) ─► worktree (intent branch, nestable) ─► terminal session (PTY) ─► subagent ─► …
```

Every node pulses by its live status — **green** = working, **orange** =
awaiting-approval / waiting, **gray (no pulse)** = idle / ready, **red** = error
— and non-leaf nodes roll up their children's worst state. The screen is a full
control surface, not just a view: clicking a terminal or subagent node navigates
to that session in the workspace; pause/resume (SIGSTOP/SIGCONT) and kill act on
the underlying PTY inline. Agent/subagent nodes use distinctive icons with a
beautiful pulse animation.

## Users

The single operator (the developer running mechsuit) driving many concurrent
agent/terminal sessions across many directories and git worktrees. They need one
glance to see what is running, stuck, waiting, or errored across the whole fleet,
and a fast way to jump to or intervene on any of it.

## Problem

Today mechsuit shows one directory's tiles at a time. There is no cross-directory
overview, git worktrees are not represented at all, and subagents are completely
invisible. With INFERNO running parallel builder subagents inside intent
worktrees, the operator cannot see the shape of concurrent work or where
attention is needed without clicking through directories one by one.

## Success Criteria

- A button in the top bar toggles a full-window graph screen (over the workspace) and back.
- The graph renders the full live tree — repos → worktrees → terminal sessions → subagents — with smooth pan/zoom when many nodes are present.
- Each node reflects live status via the four-state pulse scheme (green/orange/gray-still/red); parent nodes aggregate (roll up) their children's worst status.
- Subagents are detected for sessions running Claude Code by parsing the live PTY output stream the status engine already consumes (Claude Code's Task/subagent render markers), keyed by sessionId, and appear/disappear live as they spawn and finish.
- From a node: clicking a terminal/subagent navigates to that session in the workspace; pause/resume and kill act on the underlying PTY (kill behind a confirmation).
- Updates are live and event-driven — no manual refresh.

## Constraints

- Stack: Tauri v2 (Rust) backend + React/TypeScript (Vite) frontend + xterm.js. Follow the existing event-driven patterns (`statusEngine`/`statusStore`, `ipc/events`, Tauri commands+events).
- Reuse the existing `SessionStatus` model (`working | awaiting-approval | ready | error`) — do NOT fork status-derivation logic.
- Subagent detection parses the live PTY output stream (`session://output`) that the status engine already consumes — no transcript files, no backend. Because the stream is keyed by sessionId, attribution is exact even when sessions share a cwd / intent worktree; it MUST degrade gracefully when a session is not Claude Code (no false subagents).
- Worktrees are discovered via `git worktree list` per repo; handle nested worktrees and the reality that INFERNO builders SHARE one intent worktree (the worktree axis is distinct from the subagent axis — never assume one-worktree-per-subagent).
- Must not require restarting the app or killing live PTY sessions to function; all verification is headless (no GUI on the active display; off-screen Xvfb only).
- Performance: remains smooth with dozens of nodes.

## Notes

- Pause/resume/kill from the graph mirrors capabilities mechsuit already has (`pausedStore`, SIGSTOP/SIGCONT, Commander pause/resume/kill, `killSession`).
- "Beautiful pulsing animation + cool agent icons" is an explicit design goal. A design doc (high-complexity work item) will own the graph layout (full tree, pan/zoom), node iconography, and the pulse styling; the design skill comes in during the build for that item.
- The four pulse states map 1:1 onto the existing `SessionStatus`: working→green-pulse, awaiting-approval→orange-pulse, ready→gray-still, error→red-pulse.
