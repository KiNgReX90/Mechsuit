---
id: settings-store-ipc
title: Settings IPC + store — types, invoke wrappers, settingsStore
intent: settings-workspace-root
kind: frontend
complexity: low
mode: autopilot
status: pending
depends_on: [settings-backend]
created: 2026-06-16T14:10:43Z
---

# Work Item: Settings IPC + store — types, invoke wrappers, settingsStore

## Description

Expose the settings backend to the frontend.

- Add an `AppSettings` type (`{ workspaceRoot: string }`) to `src/types/index.ts`
  mirroring the Rust camelCase model.
- Add `getSettings()` / `setSettings(settings)` invoke wrappers to
  `src/ipc/commands.ts`.
- Add `src/state/settingsStore.ts` (zustand) with `settings`, `load()`, and
  `setWorkspaceRoot(path)` that calls `setSettings` and updates local state —
  mirroring `directoriesStore`.

## Acceptance Criteria

- [ ] `getSettings`/`setSettings` wrappers call the matching commands with the
      correct camelCase args.
- [ ] `settingsStore.load()` populates `settings`; `setWorkspaceRoot` persists via
      `setSettings` and updates state (test with mocked ipc).
- [ ] `npm test` and `tsc --noEmit` pass.

## Team Execution Manifest

context:
  required:
    - path: src/ipc/commands.ts
      reason: add getSettings/setSettings wrappers (matches existing invoke style)
    - path: src/types/index.ts
      reason: add AppSettings type mirroring the Rust model
    - path: src/state/directoriesStore.ts
      reason: zustand store + ipc-wrapping pattern to mirror for settingsStore
  patterns:
    - path: src/state/sessionsStore.ts
      reason: zustand store with async actions wrapping ipc, mocked in tests
    - path: src/state/sessionsStore.test.ts
      reason: store test pattern (mock ipc layer)
  tests:
    - path: src/state/sessionsStore.test.ts
      reason: pattern for settingsStore.test.ts
ownership:
  editable:
    - src/ipc/commands.ts
    - src/types/index.ts
    - src/state/settingsStore.ts
    - src/state/settingsStore.test.ts

## Technical Notes

Keep the store shape minimal; the panel UI item consumes `setWorkspaceRoot`.

## Dependencies

- settings-backend
