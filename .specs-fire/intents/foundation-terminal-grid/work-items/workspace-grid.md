---
id: workspace-grid
title: Workspace grid — action bar, tiled sessions, expand/focus, input routing
intent: foundation-terminal-grid
kind: ui
complexity: high
mode: autopilot
status: pending
depends_on: [ts-ipc-contract, grid-layout-util, terminal-view]
created: 2026-06-16T04:45:28Z
---

# Work Item: Workspace grid — action bar, tiled sessions, expand/focus, input routing

## Description

Implement the directory workspace view: a standard action bar (first action "add terminal" →
`spawnSession(selectedDirectoryPath)`), rendering of the selected directory's sessions tiled
via `computeGridLayout`, composing `Terminal` components; expand/focus behavior (clicking a
tile sets `focusedSessionId`; an expand control sets `expandedSessionId` to fill the
workspace and back to grid); routing keyboard input to the focused session; and populating
`sessionsStore` from `listSessions` for the selected directory, kept per-directory when
switching.

## Acceptance Criteria

- [ ] The action bar renders with an "add terminal" action that calls `spawnSession(selectedDirectoryPath)` and adds the new session tile.
- [ ] Sessions render tiled per `computeGridLayout(n)` (top-row-heavy): 1 = full, 4 = 2×2, 5 = 3/2, 9 = 5/4.
- [ ] Expanding a session fills the workspace; collapsing returns to the grid (`expandedSessionId`).
- [ ] The focused session is tracked (`focusedSessionId`) and receives keyboard input; clicking a tile focuses it.
- [ ] Switching `selectedDirectoryPath` shows that directory's sessions; sessions spawned for other directories remain in the store (not destroyed).
- [ ] Vitest tests (ipc mocked, `Terminal` mocked) cover: add-terminal increments tiles, layout rows for n ∈ {1,4,5,9}, expand toggle, and focus selection.

## Team Execution Manifest

context:
  required:
    - path: src/components/Workspace/Workspace.tsx
      reason: stub from ts-ipc-contract to implement
    - path: src/lib/gridLayout.ts
      reason: computeGridLayout for tile arrangement
    - path: src/components/Terminal/index.ts
      reason: Terminal component to compose into each tile
    - path: src/state/sessionsStore.ts
      reason: skeleton slice to fill with per-directory session state
    - path: src/ipc/commands.ts
      reason: spawnSession / listSessions wrappers
    - path: src/state/uiStore.ts
      reason: selectedDirectoryPath / focusedSessionId / expandedSessionId
  patterns:
    - path: src/components/Terminal/Terminal.tsx
      reason: component + store-consumption pattern from terminal-view
  tests:
    - path: src/components/Workspace/Workspace.test.tsx
      reason: created here; RTL + Vitest with mocked ipc and mocked Terminal
ownership:
  editable:
    - src/components/Workspace/Workspace.tsx
    - src/components/Workspace/Workspace.test.tsx
    - src/components/Workspace/ActionBar.tsx
    - src/components/Workspace/Grid.tsx
    - src/components/Workspace/Workspace.css
    - src/components/Workspace/index.ts
    - src/state/sessionsStore.ts

## Technical Notes

Filling `sessionsStore.ts` overlaps the skeleton from `ts-ipc-contract` (serialized via
`depends_on`). Real spawn/output arrives from `pty-backend` at the orchestrator's finalize;
this slice tests against mocked ipc and a mocked `Terminal`, so it depends only on
`ts-ipc-contract`, `grid-layout-util`, and `terminal-view`. Input routing: only the focused
`Terminal` forwards keystrokes — gate on `uiStore.focusedSessionId`. This is the integration
item that ties the frontend together; it is the round-4 (final) frontier of the plan.

## Dependencies

- ts-ipc-contract
- grid-layout-util
- terminal-view
