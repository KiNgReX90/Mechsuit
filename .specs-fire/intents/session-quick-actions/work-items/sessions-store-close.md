---
id: sessions-store-close
title: sessionsStore.removeSession — kill a session and drop it from its directory list
intent: session-quick-actions
kind: behavior
complexity: low
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T06:09:19Z
---

# Work Item: sessionsStore.removeSession — kill a session and drop it from its directory list

## Description

Add a `removeSession(dirPath, sessionId)` action to `sessionsStore` that powers the per-tile
**Close** button: it calls `killSession(sessionId)` (already wrapped in `src/ipc/commands.ts`)
to terminate the PTY, then removes that session from the directory's list in
`sessionsByDirectory`, leaving every other directory's sessions untouched (same
copy-on-write update pattern as `addSession`).

This is the store/behavior half of Close; the UI wiring (clearing focus/expand, rendering the
button) lives in the wiring item that depends on this.

## Acceptance Criteria

- [ ] `SessionsState` gains `removeSession: (dirPath: string, sessionId: string) => Promise<void>`.
- [ ] `removeSession` calls `killSession(sessionId)` from the ipc layer.
- [ ] After it resolves, the session is gone from `sessionsByDirectory[dirPath]` and other directories' arrays are unchanged (preserve the immutable spread pattern used by `addSession`).
- [ ] Removing a session id that is not present is a no-op for the list (still calls `killSession`, or guards gracefully — pick one and test it).
- [ ] `sessionsStore.test.ts` (Vitest, ipc mocked) covers: `removeSession` calls `killSession` with the id and drops exactly that session while leaving siblings and other directories intact.

## Team Execution Manifest

context:
  required:
    - path: src/state/sessionsStore.ts
      reason: the store to extend — follow addSession's immutable update shape
    - path: src/ipc/commands.ts
      reason: killSession(sessionId) wrapper to call
  patterns:
    - path: src/state/sessionsStore.ts
      reason: addSession is the exact pattern (per-directory copy-on-write, ipc call then set)
  tests:
    - path: src/components/Workspace/Workspace.test.tsx
      reason: pattern for mocking ipc commands and seeding sessionsStore in tests (no store test exists yet)
ownership:
  editable:
    - src/state/sessionsStore.ts
    - src/state/sessionsStore.test.ts

## Technical Notes

`killSession` is already exported from `src/ipc/commands.ts`; no new ipc wrapper or Rust
command is needed (the backend `kill_session` landed in the foundation intent).

Do NOT touch `uiStore`: it is declared complete. Clearing `focusedSessionId` /
`expandedSessionId` when the closed session was focused/expanded is the wiring item's job,
done through the existing `uiStore` setters.

## Dependencies

(none)
