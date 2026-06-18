---
id: wi-05-topbar-screen-scaffold
title: Top-bar button + full-window graph screen scaffold
intent: sessions-graph
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-17
---

# Work Item: Top-bar button + full-window graph screen scaffold

## Description

Add the entry point and full-window container for the graph screen. Add a graph
toggle button to `TitleBar` (mirroring the existing settings button), add
`graphOpen` state plus `setGraphOpen` / `toggleGraph` actions to `uiStore`, and
render a new full-window `SessionsGraph` screen in `App` that overlays the
workspace body when `graphOpen` is true — with an empty canvas placeholder child
(the slot wi-06 fills) and a close affordance — wrapped in an `ErrorBoundary` like
the other regions.

## Acceptance Criteria

- [ ] A new title-bar button toggles the graph screen; its pressed state reflects `graphOpen` via `aria-expanded`.
- [ ] `uiStore` gains `graphOpen` (default closed), `setGraphOpen`, and `toggleGraph`.
- [ ] When open, `SessionsGraph` fills the body over the workspace and can be closed (button and/or Escape); when closed the normal workspace shows.
- [ ] The container mounts an empty placeholder child (the canvas slot for wi-06) and is wrapped in `ErrorBoundary` in `App`.
- [ ] Tests cover the `uiStore` toggle and the `TitleBar` button; `npm test` + `npm run build` pass.

## Execution Manifest

context:
  required:
    - path: src/components/TitleBar/TitleBar.tsx
      reason: add the graph button here, mirroring the settings button + uiStore wiring
    - path: src/state/uiStore.ts
      reason: add graphOpen state + setGraphOpen/toggleGraph actions
    - path: src/App.tsx
      reason: render the SessionsGraph screen over the body, ErrorBoundary-wrapped
    - path: src/components/Settings/Settings.tsx
      reason: pattern for an open/close panel driven by uiStore and mounted in App
    - path: src/components/Commander/Commander.tsx
      reason: pattern for a full-area overlay over the workspace with open/close
  patterns:
    - path: src/components/TitleBar/TitleBar.tsx
      reason: button markup + uiStore toggle wiring (settings toggle)
    - path: src/components/Settings/index.ts
      reason: component index/export convention for a new components/ subfolder
  tests:
    - path: src/components/TitleBar/TitleBar.test.tsx
      reason: title-bar button test convention
    - path: src/state/uiStore.test.ts
      reason: store action test convention
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/components/TitleBar/TitleBar.tsx
    - src/components/TitleBar/TitleBar.test.tsx
    - src/state/uiStore.ts
    - src/state/uiStore.test.ts
    - src/App.tsx
    - src/components/SessionsGraph/SessionsGraph.tsx
    - src/components/SessionsGraph/index.ts

## Technical Notes

Keep the container dumb: it owns open/close + layout shell only; the actual graph
rendering is wi-06, which owns `GraphCanvas`/`GraphNode` inside this folder
(disjoint files). Overlap with wi-06 is on the `SessionsGraph/` directory only and
is not concurrent (wi-06 depends_on this item).

## Dependencies

(none)
