---
id: wi-02-active-workspaces-hook
title: Active-workspaces data hook (load all directories, derive active set)
intent: collected-view
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-18
---

# Work Item: Active-workspaces data hook (load all directories, derive active set)

## Description

Add the one genuinely new mechanic behind the collected view: loading every
managed directory's sessions and deriving the active set. Provide a hook
(`useActiveWorkspaces`) in `src/lib` that, on mount, loads sessions for ALL
managed directories — looping `sessionsStore.loadDirectory` over
`directoriesStore.directories` (ensuring the directory list itself is loaded) —
and returns, reactively, the directories that currently have at least one live
session, each paired with its `DirectoryInfo` (path + git branch) and its
`SessionInfo[]`. The result recomputes from `sessionsByDirectory` + `directories`
so bays appear and disappear live as sessions spawn and exit.

Return shape: `Array<{ directory: DirectoryInfo; sessions: SessionInfo[] }>`,
ordered stably (e.g. by the directory list order). This is the contract `wi-04`
consumes.

## Acceptance Criteria

- [ ] The hook loads sessions for every managed directory on mount (today only the selected directory is loaded), reusing `sessionsStore.loadDirectory` — no terminal is disposed or re-spawned.
- [ ] It returns only directories with ≥1 live session, each with its `DirectoryInfo` (path, git branch) and `SessionInfo[]`, recomputed reactively when sessions or the directory list change.
- [ ] A directory dropping to zero sessions is excluded; a previously-empty directory gaining a session is included — live, no manual refresh.
- [ ] Ordering is stable across recomputes (no tile/bay reshuffle on unrelated spawn/exit).
- [ ] Unit tests cover: loads all directories, filters to active, recomputes on session add/remove, and stable ordering — mocking the stores/ipc as existing store tests do; `npm test` + `npm run build` pass.

## Execution Manifest

context:
  required:
    - path: src/state/sessionsStore.ts
      reason: loadDirectory + sessionsByDirectory (keyed by directory path) to load and read sessions
    - path: src/state/directoriesStore.ts
      reason: directories list + load() to enumerate every managed directory
    - path: src/types/index.ts
      reason: DirectoryInfo (path + git branch field) and SessionInfo shapes for the return type
  patterns:
    - path: src/components/Workspace/Workspace.tsx
      reason: existing per-directory load pattern (loadDirectory in an effect) to generalize across all dirs
    - path: src/state/sessionsStore.test.ts
      reason: store/ipc mocking + reactive-selector test convention
  tests:
    - path: src/lib/activeWorkspaces.test.ts
      reason: new unit test (verification target)
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/lib/activeWorkspaces.ts
    - src/lib/activeWorkspaces.test.ts

## Technical Notes

Pure data/composition — no UI, no new IPC. Reuse `loadDirectory` as-is (it
reconciles per directory and preserves order); loading is idempotent, so calling
it for every directory on open is safe. Do not fork status/paused derivation —
the bay's `<Grid>` already reads those stores. This item neither imports the
scaffold (`wi-01`) nor the bay component (`wi-03`) — disjoint files — so it runs in
parallel with both.

## Dependencies

(none)
