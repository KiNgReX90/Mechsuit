---
id: session-status-engine
title: Session Status Engine — output-driven state machine & border styling
status: pending
created: 2026-06-16T05:01:06Z
---

# Intent: Session Status Engine — output-driven state machine & border styling

## Goal

Give every session a live status derived by parsing its terminal output, and reflect that
status as a colored (and animated) border on the session tile, so the user can see at a
glance which sessions need attention. States: **working**, **awaiting approval**,
**done/ready**, **error/timeout**.

## Users

The developer supervising many concurrent agent-CLI sessions tiled on one screen, who cannot
afford to read each session's output to learn its state.

## Problem

With many tiled sessions, the user can't tell which finished, which is blocked waiting for
approval, and which errored without reading each one. A visible per-session status removes
that scanning cost and lets the user jump straight to the session that needs them.

## Success Criteria

- Each session has a derived status: `working` | `awaiting-approval` | `ready` (done) |
  `error` (includes timeout).
- Status is derived by **parsing the PTY output stream** (agent-agnostic heuristics):
  approval-prompt patterns → `awaiting-approval`; activity-then-idle → `ready`/done;
  known error patterns / non-zero exit / no-output timeout → `error`.
- **Border styling** per status on the session tile:
  - **Focused** session → **cyan** border. Focus **wins** over status color; the underlying
    status still surfaces in the sidebar dots (see `sidebar-status-dots`).
  - **Done/ready** → border **blinks green** briefly to grab attention; the blink **stops
    after a short period**; the ready mark **persists until the user clicks/focuses** that
    session to acknowledge it, which clears it. (`done` and `ready` are the SAME state.)
  - **Awaiting approval** → **orange** border.
  - **Error/timeout** → **red** border.
- Acknowledging a ready session (click/focus) clears its ready mark and decrements the
  sidebar green dot.
- Status updates live as output streams.

## Constraints

- Builds on `foundation-terminal-grid`: consumes `session://output` events + the session
  model; adds status fields to the stores and status styling to the Workspace/Terminal tiles.
- Output parsing is **heuristic and agent-agnostic**, primary target the Claude Code CLI. It
  must **degrade gracefully** for unknown agents / plain shells — never emit a false
  "awaiting approval".
- **Focus wins (cyan)** over status border color (user decision, 2026-06-16).
- `done` = `ready` single state; ready **persists until acknowledged** by click/focus
  (user decision, 2026-06-16).

## Notes

**Depends on `foundation-terminal-grid`.** The `sidebar-status-dots` intent consumes these
statuses, so capture/decompose this intent **before** `sidebar-status-dots`. Independent of
`session-quick-actions`.

Open items to resolve at decomposition:
- Exact regex/heuristics for approval prompts and error detection (Claude Code first).
- Idle/timeout thresholds (configurable) and what "timeout" means: no output for a
  configurable interval while presumed working → `error`/red (confirm semantics).
- Blink rate + duration; where status lives in state (e.g. a `status` field on the session
  in `sessionsStore`).
- Whether focusing a ready session both focuses AND acknowledges it (likely yes).
