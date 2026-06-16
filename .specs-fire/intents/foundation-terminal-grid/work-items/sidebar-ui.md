---
id: sidebar-ui
title: Sidebar UI — directory list, + add, git branch display, selection
intent: foundation-terminal-grid
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [ts-ipc-contract]
created: 2026-06-16T04:45:28Z
---

# Work Item: Sidebar UI — directory list, + add, git branch display, selection

## Description

Implement the left sidebar: render the list of added directories as buttons (path/name
label, with the git branch shown underneath in a distinct color when present), a `+` button
to add a directory by hand, and selection that sets `uiStore.selectedDirectoryPath` to enter
a directory's workspace. Populate `directoriesStore` from `listDirectories()` on mount.
Tests mock the ipc layer.

## Acceptance Criteria

- [ ] On mount, calls `listDirectories()` and renders each directory as a button showing its name/path.
- [ ] Git repositories show their `branch` beneath the path in a visually distinct font color; non-git directories show no branch line.
- [ ] The `+` button adds a directory (path text input is acceptable for the base) → `addDirectory()` → store updates → the directory appears in the list.
- [ ] Clicking a directory sets `uiStore.selectedDirectoryPath`; the active directory is visually indicated.
- [ ] Vitest + React Testing Library tests (ipc mocked) cover: list render, branch shown vs. hidden, add flow, and selection updating `uiStore`.

## Team Execution Manifest

context:
  required:
    - path: src/components/Sidebar/Sidebar.tsx
      reason: stub from ts-ipc-contract to implement
    - path: src/ipc/commands.ts
      reason: addDirectory / listDirectories wrappers to call
    - path: src/state/uiStore.ts
      reason: selectedDirectoryPath setter for entering a directory
    - path: src/state/directoriesStore.ts
      reason: skeleton slice to fill with directory list state
  patterns:
    - path: src/App.tsx
      reason: how Sidebar is mounted into the shell (from ts-ipc-contract)
    - path: src/state/uiStore.ts
      reason: Zustand store usage pattern
  tests:
    - path: src/components/Sidebar/Sidebar.test.tsx
      reason: created here; RTL + Vitest with mocked ipc
ownership:
  editable:
    - src/components/Sidebar/Sidebar.tsx
    - src/components/Sidebar/Sidebar.test.tsx
    - src/components/Sidebar/Sidebar.css
    - src/components/Sidebar/index.ts
    - src/state/directoriesStore.ts

## Technical Notes

Filling `directoriesStore.ts` overlaps the skeleton from `ts-ipc-contract` (serialized via
`depends_on`). A native folder picker (Tauri dialog plugin) is optional; a path text input
is fine for the base. Runtime branch data comes from `directory-backend` and is integrated at
the orchestrator's finalize — this slice tests against mocked ipc, so it does not list
`directory-backend` as a dependency. Disjoint from `terminal-view` and `workspace-grid`.

## Dependencies

- ts-ipc-contract
