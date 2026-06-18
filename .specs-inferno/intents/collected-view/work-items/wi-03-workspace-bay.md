---
id: wi-03-workspace-bay
title: WorkspaceBay component + Grid expand opt-out
intent: collected-view
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-18
---

# Work Item: WorkspaceBay component + Grid expand opt-out

## Description

Build the `WorkspaceBay` component — one titled bay for a single workspace — and
make the shared `Grid` able to suppress the per-tile expand control (collected
view omits expand). `WorkspaceBay` renders a header (directory display name + git
branch + the 2/4/6/8 quick-spawn controls via `quickSpawnTargets`/`spawnsToReach`
+ an add-terminal button) over a `<Grid>` of that directory's sessions with
expand suppressed. Add an optional `showExpand` (default `true`) to `Grid` and
`SessionActions`; when `false` the expand/collapse button is not rendered. The
normal `Workspace` path keeps expand via the default, so it is unchanged.

`WorkspaceBay` is presentational and wired entirely by props so `wi-04` owns the
store wiring: `{ directory: DirectoryInfo; sessions: SessionInfo[];
focusedSessionId: string | null; onSpawnTerminals: (count: number) => void;
onCloseSession: (id: string) => void }`.

## Acceptance Criteria

- [ ] `Grid` + `SessionActions` accept `showExpand` (default `true`, backward-compatible); when `false` the expand/collapse button is absent. The existing `Workspace` view is unchanged.
- [ ] `WorkspaceBay` renders a header with the directory display name + git branch and quick-spawn controls (2/4/6/8 spawn-to-target via `quickSpawnTargets(sessions.length)`/`spawnsToReach`, same semantics as `ActionBar`) plus an add-terminal button; activating a control calls `onSpawnTerminals(count)`.
- [ ] `WorkspaceBay` tiles its sessions through the shared `<Grid>` (expand suppressed) so focus, status borders, paused dimming, and close behave identically; per-tile close routes to `onCloseSession(id)`.
- [ ] `WorkspaceBay` is unit-tested in isolation (header renders name+branch+controls; spawn/close callbacks fire; Grid present with no expand button); `npm test` + `npm run build` pass.

## Execution Manifest

context:
  required:
    - path: src/components/Workspace/Grid.tsx
      reason: reuse for tiling; add optional showExpand threaded to SessionActions
    - path: src/components/Workspace/SessionActions.tsx
      reason: add optional showExpand to hide the expand/collapse button
    - path: src/components/Workspace/ActionBar.tsx
      reason: pattern for the quick-spawn + add-terminal controls (GridGlyph, quickSpawnTargets)
    - path: src/lib/quickSpawn.ts
      reason: quickSpawnTargets/spawnsToReach for the bay's spawn controls
    - path: src/types/index.ts
      reason: DirectoryInfo + SessionInfo prop shapes
  patterns:
    - path: src/components/Workspace/ActionBar.tsx
      reason: quick-spawn button markup + GridGlyph rendering
    - path: src/components/Workspace/SessionActions.test.tsx
      reason: component test convention (assert expand hidden when showExpand=false)
  tests:
    - path: src/components/CollectedWorkspace/WorkspaceBay.test.tsx
      reason: new unit test for the bay
    - path: src/components/Workspace/SessionActions.test.tsx
      reason: assert the expand/collapse button is hidden when showExpand=false
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/components/Workspace/Grid.tsx
    - src/components/Workspace/SessionActions.tsx
    - src/components/Workspace/SessionActions.test.tsx
    - src/components/CollectedWorkspace/WorkspaceBay.tsx
    - src/components/CollectedWorkspace/WorkspaceBay.test.tsx
    - src/components/CollectedWorkspace/WorkspaceBay.css

## Technical Notes

`WorkspaceBay` is wired by props so `wi-04` owns the store wiring (spawn/close)
and focus; the bay neither imports `CollectedWorkspace` nor the active-workspaces
hook, so it builds in parallel with `wi-01`/`wi-02`. The `Grid`/`SessionActions`
change is additive (optional prop, default preserves today's behavior) and is the
only edit to the existing `Workspace` folder — no other item touches those files.
Do NOT reimplement focus: `Grid` already routes tile clicks through
`focusSession`. Co-locate bay styling in `WorkspaceBay.css`.

## Dependencies

(none)
