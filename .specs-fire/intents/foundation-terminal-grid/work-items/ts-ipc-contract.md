---
id: ts-ipc-contract
title: Frontend IPC contract — types, command/event wrappers, stores, app shell
intent: foundation-terminal-grid
kind: architecture
complexity: medium
mode: autopilot
status: pending
depends_on: [project-init]
created: 2026-06-16T04:45:28Z
---

# Work Item: Frontend IPC contract — types, command/event wrappers, stores, app shell

## Description

Establish the frontend side of the IPC contract so the React feature items (`sidebar-ui`,
`terminal-view`, `workspace-grid`) build in parallel against typed wrappers and a shared
store. Define TS types mirroring the Rust models, typed `invoke` wrappers for every command,
event-subscription helpers for `session://output`/`session://exit`, and Zustand stores: a
complete `uiStore` plus empty `directoriesStore`/`sessionsStore` slices for feature items to
fill. Wire `App.tsx` to mount stub `Sidebar` and `Workspace` components into the two-pane
shell.

## Acceptance Criteria

- [ ] `src/types/index.ts` defines `DirectoryInfo { path; name; isGitRepo; branch: string | null }`, `SessionInfo { id; dirPath }`, and event payloads `OutputEvent { sessionId; data }`, `ExitEvent { sessionId; code }`.
- [ ] `src/ipc/commands.ts` exports typed async wrappers (`addDirectory`, `listDirectories`, `removeDirectory`, `spawnSession`, `writeSession`, `resizeSession`, `killSession`, `listSessions`) calling `invoke(...)` from `@tauri-apps/api/core`.
- [ ] `src/ipc/events.ts` exports `onSessionOutput(cb)` and `onSessionExit(cb)` using `listen` from `@tauri-apps/api/event`, each returning an unlisten function.
- [ ] `src/state/uiStore.ts` (Zustand) is complete: `selectedDirectoryPath`, `focusedSessionId`, `expandedSessionId` and their setters.
- [ ] `src/state/directoriesStore.ts` and `src/state/sessionsStore.ts` exist as typed empty/skeleton slices (no behavior).
- [ ] `App.tsx` mounts stub `Sidebar` and `Workspace` into the shell; both stubs render placeholder content and compile.
- [ ] A Vitest test covers `uiStore` setters and at least one ipc wrapper with `invoke` mocked; `npm run build` (tsc) and `npm test` pass.

## Team Execution Manifest

context:
  required:
    - path: src/App.tsx
      reason: shell from project-init; this item mounts the stub components
    - path: .specs-fire/intents/foundation-terminal-grid/brief.md
      reason: the IPC contract (command/event/type names) is documented in the brief and plan
  patterns:
    - path: src/main.tsx
      reason: frontend entry convention from project-init
    - path: package.json
      reason: available deps (zustand, @tauri-apps/api) declared by project-init
  tests:
    - path: src/state/uiStore.test.ts
      reason: created here; Vitest unit test for store + a mocked ipc wrapper
ownership:
  editable:
    - src/types/index.ts
    - src/ipc/commands.ts
    - src/ipc/events.ts
    - src/state/uiStore.ts
    - src/state/uiStore.test.ts
    - src/state/directoriesStore.ts
    - src/state/sessionsStore.ts
    - src/App.tsx
    - src/components/Sidebar/Sidebar.tsx
    - src/components/Sidebar/index.ts
    - src/components/Workspace/Workspace.tsx
    - src/components/Workspace/index.ts

## Technical Notes

camelCase TS field names MUST match the Rust `#[serde(rename_all = "camelCase")]` models in
`rust-ipc-contract`. Mock `@tauri-apps/api/core`'s `invoke` (and `.../event`'s `listen`) in
tests. `sidebar-ui` fills `Sidebar/` + `directoriesStore.ts`; `workspace-grid` fills
`Workspace/` + `sessionsStore.ts`; both depend on this item so the stub→fill overlap is
serialized. `terminal-view` creates `Terminal/` fresh (no stub needed here, since Workspace
composes it, not App).

## Dependencies

- project-init
