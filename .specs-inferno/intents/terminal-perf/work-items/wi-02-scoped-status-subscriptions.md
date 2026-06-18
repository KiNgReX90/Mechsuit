---
id: wi-02-scoped-status-subscriptions
title: Scope status subscriptions so a status change re-renders one tile, not the grid
intent: terminal-perf
kind: ui
complexity: low
mode: autopilot
status: pending
depends_on: []
created: 2026-06-18
---

# Work Item: Scope status subscriptions so a status change re-renders one tile, not the grid

## Description

`Grid` subscribes to the entire `statusBySession` object
(`src/components/Workspace/Grid.tsx:69`), so any session flipping status
(working↔idle↔ready) re-renders the whole grid and reconciles every tile —
including all the `<Terminal>` children — under load. Narrow the subscription so a
status transition re-renders only the affected tile.

Extract a per-tile child component (e.g. `GridTile`, co-located in
`src/components/Workspace/`) that renders one session's tile and subscribes to
ONLY that session's status via a scoped selector
(`useStatusStore((s) => s.statusBySession[session.id])`). `Grid` then maps
sessions to `<GridTile>` children and no longer reads the whole `statusBySession`
map. Keep the existing tile markup, class composition (`tileStatusClass`),
focus/click/`onKeyDownCapture` behavior, paused badge, header, `SessionActions`,
and `<Terminal>` exactly as they are today — this is a re-render-scoping
refactor, not a behavior change. `tileStatusKind` / `tileStatusClass` stay
exported from `Grid.tsx` (other modules import them).

## Acceptance Criteria

- [ ] `Grid` no longer subscribes to the whole `statusBySession` object; each tile
      subscribes only to its own session's status.
- [ ] A single session's status change re-renders only that tile (verified by a
      focused render-count or selector test).
- [ ] Visible behavior is unchanged: focused-tile accent border, status-color
      border for non-focused tiles, paused dimming + resume, header/name,
      `SessionActions`, click-to-focus, and non-focused capture-phase key
      swallowing all behave as before.
- [ ] `tileStatusKind` and `tileStatusClass` remain exported from `Grid.tsx`.
- [ ] `npm test` passes (incl. the Workspace/grid suites); `npm run build` passes.

## Execution Manifest

context:
  required:
    - path: src/components/Workspace/Grid.tsx
      reason: holds the whole-object subscription and the per-tile render loop to split into a scoped child
    - path: src/state/statusStore.ts
      reason: state shape and the no-op-guarded setStatus; the scoped selector reads statusBySession[id]
  patterns:
    - path: src/components/Workspace/Workspace.tsx
      reason: example of a narrow zustand selector (sessionsByDirectory[path]) to mirror for per-session status
    - path: src/components/Workspace/SessionActions.tsx
      reason: pattern for a small co-located tile-scoped component in this folder
  tests:
    - path: src/components/Workspace/Workspace.test.tsx
      reason: existing suite that renders the grid/tiles; pattern for a new focused Grid/GridTile render test
ownership:
  editable:
    - src/components/Workspace/Grid.tsx
    - src/components/Workspace/GridTile.tsx
    - src/components/Workspace/Grid.test.tsx

finalize_check: "! git grep -F 's.statusBySession)' -- src/components/Workspace/Grid.tsx"

## Technical Notes

- The scoped selector returns a `SessionStatusState | undefined`; zustand compares
  it by reference and the store already keeps a stable reference when nothing
  changed (the no-op guard in `setStatus`), so an unaffected tile will not
  re-render.
- `Workspace.tsx` also subscribes to the whole `statusBySession` for the *expanded*
  single tile; that is a single-tile case and is intentionally left alone here to
  keep ownership disjoint and the change small. Note it as a possible later tidy.
- `GridTile.tsx` / `Grid.test.tsx` are new files in the same folder; create them
  following the existing component + test conventions.

## Dependencies

(none)
