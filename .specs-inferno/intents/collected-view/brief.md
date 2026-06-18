---
id: collected-view
title: Collected View — All Workspaces On One Screen
status: pending
created: 2026-06-18
---

# Intent: Collected View — All Workspaces On One Screen

## Goal

Add a top-bar toggle that flips the main area into a **collected view**: a
full-window working surface that gathers the terminals from *every* active
workspace onto one screen, **grouped by workspace**. The sidebar disappears for
the full width. Each active directory becomes a titled "bay" — its name, its git
branch, and its own 2/4/6/8 quick-spawn controls — laid out as an auto-grid of
bays (the bays tile like the session grid tiles terminals), and inside each bay
its sessions tile through the existing grid. The whole thing is interactive: you
can click any terminal across any bay to focus and type into it, exactly as in
the per-workspace view.

It mirrors the existing Sessions Graph precedent: a `collectedOpen` flag in
`uiStore` plus a `TitleBar` button, rendered as a full-body overlay that fills
`.app-body` above the usage footer and covers the sidebar. The current
per-workspace `Workspace`/`Sidebar` render path is left untouched underneath;
toggling off returns to it with selection intact.

## Users

The single operator (the developer running mechsuit) driving many concurrent
agent/terminal sessions across several directories. Today they see one
directory's tiles at a time and must click through the sidebar to reach another
directory's work. They want one screen that shows — and lets them drive — every
live terminal across all their workspaces at once.

## Problem

The per-workspace view only ever shows the selected directory's sessions. To
work across directories the operator constantly switches the selected workspace
in the sidebar, losing the other directories' terminals from view. There is no
single surface to type into terminals belonging to different workspaces without
that round-trip. (The Sessions Graph gives a cross-directory *monitoring*
overview, but it is not a place to actually work — you cannot type into a
terminal there.)

## Success Criteria

- A `TitleBar` toggle (beside the graph button) flips the main area into the
  collected view and back; collected view and the graph are mutually exclusive
  full-screen modes (opening one closes the other).
- In collected view the sidebar is hidden and the surface fills the full body
  width above the usage footer.
- Every **active** workspace — a directory with at least one live session —
  appears as a titled bay; directories with no live sessions are omitted. Bays
  are arranged as an auto-grid using the same layout rule the session grid uses.
- Each bay shows its directory name and git branch, hosts its own 2/4/6/8
  quick-spawn controls plus an add-terminal button (same spawn-to-target
  semantics as today's `ActionBar`, scoped to that bay's directory), and tiles
  that directory's sessions through the existing grid.
- The collected view is a fully interactive working surface: clicking any
  terminal in any bay focuses it and routes keyboard input to it (one global
  focused session across the whole screen). Per-tile close and pause/resume work
  as they do today; status borders and paused dimming still apply.
- Bays update live as sessions spawn/exit (reusing the app-wide session events);
  a bay disappears when its directory drops to zero live sessions, and a new bay
  appears when a previously-empty directory gains one.
- Opening the collected view loads sessions for all directories (today only the
  selected directory is loaded) before deriving the active set, without tearing
  down or re-spawning any already-running terminal.
- Remains smooth with dozens of live terminals on screen at once.

## Constraints

- Stack: Tauri v2 (Rust) backend + React/TypeScript (Vite) frontend + xterm.js.
  Follow the existing event-driven patterns (`uiStore`, `sessionsStore`,
  `statusStore`, `pausedStore`, `ipc/events`, `terminalPool`).
- Reuse, do not fork: the existing `Grid`, `SessionActions`, `computeGridLayout`,
  `focusSession`, `quickSpawn` (`quickSpawnTargets`/`spawnsToReach`), and the
  status/paused stores. The bay's terminal tiling MUST go through the same
  `Grid` so focus, status borders, paused dimming, and close behave identically.
- Performance: every live terminal across every active workspace renders at
  once, so reuse the pooled xterm instances (`terminalPool`) — flipping into and
  out of collected view must re-parent existing terminals, never dispose or
  re-spawn them. The auto-grid means tiles can get small; that is acceptable.
- Implement as a full-body overlay mirroring `SessionsGraph` (approach C, chosen
  for performance + isolation): the existing `Workspace`/`Sidebar` path is not
  modified beyond hiding the sidebar while collected view is open.
- Verification is headless only — no GUI on the active display; off-screen Xvfb
  only. Do not restart the app or kill live PTY sessions to verify.

## Notes

- Per-tile **expand-to-full is intentionally omitted** inside collected view —
  the cross-workspace overview is the point, and a single global focused session
  already lets you drive any terminal. Expand remains available in the normal
  per-workspace view.
- Approach C (full-body overlay) was chosen over a true mode-swap or a
  generalized multi-directory `Workspace` because it reuses the proven
  `SessionsGraph` overlay pattern, adds zero risk to the tested per-workspace
  render path, and lets the toggle be a clean on/off.
- Out of scope for v1 (potential follow-on intents): cross-bay Shift+Arrow
  keyboard navigation between terminals in different bays; bay reorder/collapse;
  per-tile expand inside the collected view; an "all sidebar workspaces" variant
  that also renders empty bays for directories with no sessions.
- The one genuinely new mechanic is loading every directory's sessions on open;
  the rest is composition of existing, tested pieces.
