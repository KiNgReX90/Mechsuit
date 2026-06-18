---
id: wi-04-collected-workspace-integration
title: Assemble CollectedWorkspace — bay auto-grid, live wiring
intent: collected-view
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [wi-01-entry-scaffold, wi-02-active-workspaces-hook, wi-03-workspace-bay]
created: 2026-06-18
---

# Work Item: Assemble CollectedWorkspace — bay auto-grid, live wiring

## Description

Fill the `CollectedWorkspace` container (placeholder from `wi-01`). Consume the
active-workspaces hook (`wi-02`) to get active directories live, lay their bays
out as an auto-grid via `computeGridLayout(activeDirs.length)` (bays tile the same
way the session grid tiles terminals), and render a `WorkspaceBay` (`wi-03`) per
directory. Wire each bay's `onSpawnTerminals` to `sessionsStore.addSession(dir)`
(spawn count back-to-back, mirroring `Workspace.handleSpawnTerminals`) and
`onCloseSession` to `removeSession(dir, id)` (clearing focus state on close), and
pass the single global `focusedSessionId`. Show an empty-state message when no
workspace has a live session. Style the bay auto-grid in `CollectedWorkspace.css`.

## Acceptance Criteria

- [ ] When open, `CollectedWorkspace` shows one bay per active workspace, arranged as an auto-grid using `computeGridLayout(activeDirs.length)`; the set updates live as workspaces become active/inactive.
- [ ] Each bay's quick-spawn/add controls spawn into that bay's own directory (`addSession`), and per-tile close kills + removes from that directory (`removeSession`); focus is one global `focusedSessionId` shared across all bays.
- [ ] Entering and leaving the collected view re-parents existing pooled terminals — no terminal is disposed or re-spawned on overlay toggle.
- [ ] An empty-state message shows when no workspace has a live session.
- [ ] Tests cover: a bay renders per active directory, the bay layout uses `computeGridLayout`, and spawn/close wire to the store (mocked); `npm test` + `npm run build` pass.

## Execution Manifest

context:
  required:
    - path: src/components/CollectedWorkspace/CollectedWorkspace.tsx
      reason: the placeholder container to fill (from wi-01)
    - path: src/lib/activeWorkspaces.ts
      reason: hook returning active directories + sessions, live (from wi-02)
    - path: src/components/CollectedWorkspace/WorkspaceBay.tsx
      reason: the bay component to render once per active directory (from wi-03)
    - path: src/lib/gridLayout.ts
      reason: computeGridLayout to arrange bays into a top-row-heavy auto-grid
    - path: src/state/sessionsStore.ts
      reason: addSession/removeSession for the per-bay spawn + close wiring
    - path: src/state/uiStore.ts
      reason: focusedSessionId for the single global focus across bays
  patterns:
    - path: src/components/Workspace/Workspace.tsx
      reason: spawn/close handler pattern (sequential addSession loop; clear focus on close) and computeGridLayout row-slicing
    - path: src/components/SessionsGraph/SessionsGraph.tsx
      reason: full-body overlay body-layout pattern
  tests:
    - path: src/components/CollectedWorkspace/CollectedWorkspace.test.tsx
      reason: new integration test (verification target)
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/components/CollectedWorkspace/CollectedWorkspace.tsx
    - src/components/CollectedWorkspace/CollectedWorkspace.css
    - src/components/CollectedWorkspace/CollectedWorkspace.test.tsx

## Technical Notes

Mirror `Workspace.tsx`'s spawn/close handlers (sequential `addSession` loop;
clear `focusedSessionId`/`expandedSessionId` state when the closed id matches),
but scoped per bay/directory. Reuse `computeGridLayout` for the bay rows exactly
as `Grid` uses it for tiles (slice the active directories into rows). The overlay
shell (open/close/Escape) already exists from `wi-01` — this item replaces the
empty body slot only. Performance: many xterms mount at once; rely on the existing
`terminalPool` (`focusTerminal`/`disposeTerminal`) and do NOT add disposal on
overlay toggle, so flipping views never tears down a live terminal.

## Dependencies

- wi-01-entry-scaffold
- wi-02-active-workspaces-hook
- wi-03-workspace-bay
