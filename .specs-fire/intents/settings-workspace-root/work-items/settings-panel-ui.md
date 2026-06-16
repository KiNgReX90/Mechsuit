---
id: settings-panel-ui
title: Settings panel UI — gear control + panel with workspace-root field
intent: settings-workspace-root
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [settings-store-ipc]
created: 2026-06-16T14:10:43Z
---

# Work Item: Settings panel UI — gear control + panel with workspace-root field

## Description

Build the settings surface and wire it to the store.

- New `src/components/Settings/` (`Settings.tsx`, `Settings.css`, `index.ts`,
  `Settings.test.tsx`): a panel (drawer/modal) with a labeled **workspace root**
  input and a save action, reading/writing via `settingsStore`.
- A **gear/settings control** opening the panel. Place it in the Sidebar header
  next to the add (`+`) control (Sidebar owns the header). Toggle open state
  locally or via `uiStore` (follow the Commander open-state pattern if shared).
- On save, call `settingsStore.setWorkspaceRoot`; the next add-directory discovery
  reflects the new root.

## Acceptance Criteria

- [ ] A control labeled for settings (e.g. aria-label "Settings") opens the panel;
      a close control hides it.
- [ ] The panel shows the current workspace root and saving updates it via the
      store (assert via mocked store/ipc; roles/labels/values, not pixels).
- [ ] `Settings.test.tsx` (RTL + Vitest) covers open/close + edit→save.
- [ ] `npm test` and `tsc --noEmit` pass; existing Sidebar tests stay green.

## Team Execution Manifest

context:
  required:
    - path: src/state/settingsStore.ts
      reason: the store this panel reads/writes (created by settings-store-ipc)
    - path: src/components/Commander/Commander.tsx
      reason: existing panel/drawer component structure + open/close prop pattern to mirror
    - path: src/components/Sidebar/Sidebar.tsx
      reason: header where the gear control sits beside the add (+) button
    - path: src/components/Sidebar/Sidebar.css
      reason: header/button styling conventions
  patterns:
    - path: src/components/Commander/Commander.css
      reason: drawer/panel CSS conventions
    - path: src/components/Sidebar/Sidebar.test.tsx
      reason: RTL test pattern for sidebar-hosted controls
  tests:
    - path: src/components/Commander/Commander.test.tsx
      reason: pattern for Settings.test.tsx (panel open/close + form submit)
ownership:
  editable:
    - src/components/Settings/
    - src/components/Sidebar/Sidebar.tsx
    - src/components/Sidebar/Sidebar.css
    - src/components/Sidebar/Sidebar.test.tsx

## Technical Notes

Sidebar already calls `discoverDirectories()` with no arg, so once the backend
resolves the configured root, no Sidebar discovery change is required — only the
gear control + panel mount.

## Dependencies

- settings-store-ipc
