---
id: wire-session-actions
title: Wire SessionActions into the grid tiles and expanded view
intent: session-quick-actions
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [session-actions-component, sessions-store-close]
created: 2026-06-16T06:09:19Z
---

# Work Item: Wire SessionActions into the grid tiles and expanded view

## Description

Render the `SessionActions` icon group in both per-session headers and wire its callbacks:

- **Grid tiles (`Grid.tsx`)** — replace the lone inline expand button in each
  `.workspace-tile-header` with `<SessionActions sessionId={session.id} … />` (not expanded):
  Expand → `onExpand(session.id)`, Close → `onClose(session.id)`. Clear/Compact are handled
  inside the component.
- **Expanded view (`Workspace.tsx`)** — replace the lone collapse button in the expanded
  header with `<SessionActions … isExpanded />`: Collapse → `setExpandedSessionId(null)`,
  Close → the close handler.

Implement the **Close** handler in `Workspace.tsx` (it owns `selectedDirectoryPath`): call
`sessionsStore.removeSession(selectedDirectoryPath, id)`, and if the closed session was the
focused or expanded one, clear that state via the existing `uiStore` setters
(`setFocusedSessionId(null)` / `setExpandedSessionId(null)`). Pass the handler down to `Grid`
as a new `onClose` prop (extend `GridProps`).

## Acceptance Criteria

- [ ] Each grid tile header renders `SessionActions` (Clear, Compact, Expand, Close) for its own session; the old standalone expand button is gone but the **`Expand session ${id}`** accessible name still resolves (via the component).
- [ ] The expanded view header renders `SessionActions` in its expanded variant (Clear, Compact, Collapse, Close); the **`Collapse session`** accessible name still resolves.
- [ ] Clicking Clear/Compact on a tile routes `writeSession` to **that tile's** session id, even when the tile is not the focused one (button click does not first require focusing it).
- [ ] Clicking **Close** on a tile calls `removeSession(selectedDirectoryPath, id)`, the tile disappears, and if that session was focused/expanded the corresponding `uiStore` state is cleared.
- [ ] Existing Workspace behavior is preserved: add-terminal, layout rows for n ∈ {1,4,5,9}, focus-on-click, expand/collapse toggle, per-directory retention.
- [ ] `Workspace.test.tsx` is extended to cover: grid-tile Clear and Compact call `writeSession` with `"/clear\r"` / `"/compact\r"` and the correct (non-focused) session id; Close removes the tile and clears expand/focus; expanded-view Clear/Compact/Close behave the same. Existing tests continue to pass.

## Team Execution Manifest

context:
  required:
    - path: src/components/Workspace/Grid.tsx
      reason: tile header where the expand button is replaced by SessionActions; add onClose to GridProps
    - path: src/components/Workspace/Workspace.tsx
      reason: expanded-view header + owns selectedDirectoryPath; implement the close handler and pass onClose to Grid
    - path: src/components/Workspace/SessionActions.tsx
      reason: the component produced by session-actions-component — read its actual props to wire correctly
    - path: src/state/sessionsStore.ts
      reason: removeSession added by sessions-store-close — the close action to call
    - path: src/state/uiStore.ts
      reason: existing setFocusedSessionId / setExpandedSessionId for close cleanup (do not extend the store)
  patterns:
    - path: src/components/Workspace/Grid.tsx
      reason: existing onFocus/onExpand prop-passing + stopPropagation header button is the wiring pattern
  tests:
    - path: src/components/Workspace/Workspace.test.tsx
      reason: the integration test to extend (ipc mocked, Terminal stubbed); existing cases must keep passing
ownership:
  editable:
    - src/components/Workspace/Grid.tsx
    - src/components/Workspace/Workspace.tsx
    - src/components/Workspace/Workspace.test.tsx

## Technical Notes

Read `SessionActions.tsx` first — its prop shape (callback names, `isExpanded` flag) is
defined by the component item; wire to whatever it actually exposes rather than assuming.

Close cleanup ordering: clearing `expandedSessionId` matters because `Workspace.tsx` already
guards the expanded view with `sessions.some((s) => s.id === expandedSessionId)` — once the
session is removed from the store that guard fails and the view falls back to the grid, but
also clear the id explicitly so stale state does not linger.

Do not edit `SessionActions.tsx`, `Workspace.css`, `sessionsStore.ts`, or `uiStore.ts` — they
belong to the other items / are complete; this item only consumes them.

## Dependencies

- session-actions-component
- sessions-store-close
