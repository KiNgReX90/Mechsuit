---
id: wi-01-entry-scaffold
title: Toggle + full-window collected-view overlay scaffold
intent: collected-view
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-18
---

# Work Item: Toggle + full-window collected-view overlay scaffold

## Description

Add the entry point and full-window container for the collected view, mirroring
the sessions-graph scaffold (`wi-05-topbar-screen-scaffold`). Add `collectedOpen`
state plus `setCollectedOpen` / `toggleCollected` to `uiStore`, with mutual
exclusion against `graphOpen` (opening collected closes the graph; opening the
graph closes collected — they are mutually exclusive full-screen modes). Add a
collected-view toggle button to `TitleBar` beside the graph button (distinct
icon, `aria-expanded` reflects `collectedOpen`). Render a new `CollectedWorkspace`
overlay in `App` that fills `.app-body` over the sidebar+workspace when
`collectedOpen` — with a close affordance (button and/or Escape) and an empty
placeholder body (the slot `wi-04` fills) — wrapped in an `ErrorBoundary` like the
other regions. Add `CollectedWorkspace/index.ts` and a CSS shell.

## Acceptance Criteria

- [ ] `uiStore` gains `collectedOpen` (default false), `setCollectedOpen`, and `toggleCollected`; opening collected sets `graphOpen` false and opening the graph sets `collectedOpen` false (mutually exclusive).
- [ ] A new title-bar button toggles the collected view; `aria-expanded` reflects `collectedOpen`; its icon is distinct from the settings and graph buttons.
- [ ] When `collectedOpen`, `CollectedWorkspace` fills the body over the sidebar+workspace and can be closed (button and/or Escape); when closed the normal sidebar+workspace shows with selection intact.
- [ ] `CollectedWorkspace` is a placeholder container (open/close + layout shell + empty body slot) exported via `CollectedWorkspace/index.ts` and wrapped in `ErrorBoundary` in `App`, mirroring `SessionsGraph`.
- [ ] Tests cover the `uiStore` actions (including mutual exclusion) and the `TitleBar` button; `npm test` + `npm run build` pass.

## Execution Manifest

context:
  required:
    - path: src/state/uiStore.ts
      reason: add collectedOpen + setCollectedOpen/toggleCollected, with mutual exclusion against graphOpen
    - path: src/components/TitleBar/TitleBar.tsx
      reason: add the collected-view toggle button beside the graph button, same uiStore wiring
    - path: src/App.tsx
      reason: render the CollectedWorkspace overlay over the body, ErrorBoundary-wrapped
    - path: src/components/SessionsGraph/SessionsGraph.tsx
      reason: pattern for a full-body overlay over .app-body with open/close + Escape
  patterns:
    - path: src/components/SessionsGraph/index.ts
      reason: component index/export convention for a new components/ subfolder
    - path: src/components/TitleBar/TitleBar.tsx
      reason: graph button markup + uiStore toggle wiring (the exact analog)
  tests:
    - path: src/state/uiStore.test.ts
      reason: store action test convention
    - path: src/components/TitleBar/TitleBar.test.tsx
      reason: title-bar button test convention
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/state/uiStore.ts
    - src/state/uiStore.test.ts
    - src/components/TitleBar/TitleBar.tsx
    - src/components/TitleBar/TitleBar.test.tsx
    - src/App.tsx
    - src/App.test.tsx
    - src/components/CollectedWorkspace/CollectedWorkspace.tsx
    - src/components/CollectedWorkspace/index.ts
    - src/components/CollectedWorkspace/CollectedWorkspace.css

## Technical Notes

Keep the container dumb: it owns open/close + layout shell only; the real bay
layout is `wi-04`, which rewrites `CollectedWorkspace.tsx` to fill the body slot.
Overlap with `wi-04` is on `CollectedWorkspace.tsx`/`.css` only and is not
concurrent (`wi-04` depends_on this item). Mirror `SessionsGraph` for the overlay
(fills `.app-body` above the usage footer) and the `TitleBar` graph button for the
toggle. Mutual exclusion lives in the `uiStore` setters/toggles so both the
title-bar buttons and any future hotkeys stay consistent.

## Dependencies

(none)
