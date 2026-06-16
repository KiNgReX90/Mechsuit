---
id: commander-app-wiring
title: Commander wiring — Ctrl+Shift+C hotkey, uiStore open state, mount, engine + navigate event
intent: commander-supervisor-agent
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [commander-overlay, commander-claude-driver]
created: 2026-06-16T06:17:01Z
---

# Work Item: Commander wiring — Ctrl+Shift+C hotkey, uiStore open state, mount, engine + navigate event

## Description

Wire Commander into the running app — the only item that joins the overlay, the driver, and the
backend navigate event.

- **uiStore** (`src/state/uiStore.ts`): add `commanderOpen: boolean` (default `false`) plus
  `setCommanderOpen(open)` / `toggleCommander()`, following the existing action style.
- **Hotkey**: a global `keydown` listener (in `App.tsx`, removed on unmount) that toggles
  `commanderOpen` on **Ctrl+Shift+C** (`e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")`),
  calling `preventDefault`.
- **Mount**: render `<Commander open={commanderOpen} onClose={() => setCommanderOpen(false)}
  engine={engine} />` in `App.tsx`, above the workspace.
- **Engine injection**: build the real `CommanderEngine` by wrapping `commanderSend` (from
  `commander-claude-driver`) and pass it to the overlay.
- **Navigate on scope**: subscribe to the backend **`commander://navigate`** event (add an
  `onCommanderNavigate` helper in `src/ipc/events.ts`, mirroring the existing event wrappers) and
  set `selectedDirectoryPath` from its payload, so a resolved project selects that directory in the
  sidebar.

## Acceptance Criteria

- [ ] `uiStore` exposes `commanderOpen` plus a setter and a toggle, matching the store's existing
      conventions.
- [ ] Ctrl+Shift+C toggles the overlay open/closed; the listener is removed on unmount and calls
      `preventDefault`.
- [ ] `<Commander/>` is mounted in `App.tsx`, driven by `commanderOpen`, wrapping `commanderSend`
      as the injected engine; closing sets `commanderOpen` false.
- [ ] A `commander://navigate` event sets `selectedDirectoryPath` to its payload path (sidebar
      navigates to the resolved directory).
- [ ] `App.test.tsx` covers: overlay hidden initially; Ctrl+Shift+C toggles visibility; a
      `commander://navigate` event updates the selected directory. (ipc/engine/event mocked,
      consistent with the existing App smoke test.)

## Team Execution Manifest

context:
  required:
    - path: src/App.tsx
      reason: app shell to add the hotkey listener, mount the overlay, and inject the engine
    - path: src/state/uiStore.ts
      reason: add commanderOpen state + toggle alongside existing selection state
    - path: src/ipc/events.ts
      reason: add an onCommanderNavigate subscription helper for the commander://navigate event
    - path: src/components/Commander/index.ts
      reason: import the Commander overlay component to mount
    - path: src/ipc/commands.ts
      reason: commanderSend, wrapped as the injected CommanderEngine
  patterns:
    - path: src/state/uiStore.ts
      reason: existing zustand state + setter style for the new field
    - path: src/ipc/events.ts
      reason: existing event-subscription wrapper pattern to follow
    - path: src/App.test.tsx
      reason: existing App smoke-test pattern (mocked ipc) to extend
  tests:
    - path: src/App.test.tsx
      reason: extend the App test for hotkey toggle, overlay mount, and navigate event
ownership:
  editable:
    - src/App.tsx
    - src/App.css
    - src/state/uiStore.ts
    - src/ipc/events.ts
    - src/App.test.tsx

## Technical Notes

The integration item: depends on BOTH `commander-overlay` (component) and
`commander-claude-driver` (the `commanderSend` command + `CommanderEngine` interface). The
`commander://navigate` event constant is defined backend-side in `mechsuit-mcp-server`
(`events.rs`); match the same string here. Mind `e.key` casing — with Shift held, `key` is
uppercase `"C"`.

## Dependencies

- commander-overlay
- commander-claude-driver
