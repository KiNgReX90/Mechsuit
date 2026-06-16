---
id: terminal-view
title: Terminal view — xterm.js pane bound to a session
intent: foundation-terminal-grid
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [ts-ipc-contract]
created: 2026-06-16T04:45:28Z
---

# Work Item: Terminal view — xterm.js pane bound to a session

## Description

Implement a single terminal pane component that mounts an xterm.js terminal, subscribes to
`session://output` for its `sessionId` and writes incoming data to the terminal, sends user
keystrokes via `writeSession`, fits/resizes via the fit addon calling `resizeSession`, and
cleans up listeners on unmount. This is the reusable unit the workspace grid tiles.

## Acceptance Criteria

- [ ] `<Terminal sessionId={...} />` mounts an xterm instance into a container element.
- [ ] Subscribes via `onSessionOutput` and writes data only for the matching `sessionId`; ignores others; unsubscribes on unmount.
- [ ] User input is forwarded via `writeSession(sessionId, data)`.
- [ ] Container resize (fit addon) calls `resizeSession(sessionId, cols, rows)`.
- [ ] Vitest tests (ipc/events mocked, xterm shimmed under jsdom) verify output→terminal-write and input→`writeSession` wiring and listener cleanup.

## Team Execution Manifest

context:
  required:
    - path: src/ipc/events.ts
      reason: onSessionOutput subscription helper
    - path: src/ipc/commands.ts
      reason: writeSession / resizeSession wrappers
    - path: src/types/index.ts
      reason: OutputEvent / SessionInfo shapes
  patterns:
    - path: src/App.tsx
      reason: React component + mount/cleanup pattern from ts-ipc-contract
    - path: package.json
      reason: @xterm/xterm + @xterm/addon-fit deps declared by project-init
  tests:
    - path: src/components/Terminal/Terminal.test.tsx
      reason: created here; Vitest with mocked ipc/events
ownership:
  editable:
    - src/components/Terminal/Terminal.tsx
    - src/components/Terminal/Terminal.test.tsx
    - src/components/Terminal/Terminal.css
    - src/components/Terminal/index.ts

## Technical Notes

Import `@xterm/xterm` + `@xterm/addon-fit` and the xterm CSS. Under jsdom the xterm canvas
won't truly render — mock/shim the terminal in tests and assert the wiring (write calls,
input handler, unlisten on unmount). No backend dependency for this slice: real output
arrives from `pty-backend` at the orchestrator's finalize. Creates the `Terminal/` directory
fresh (no stub needed from ts-ipc-contract). Disjoint from `sidebar-ui`; consumed by
`workspace-grid`.

## Dependencies

- ts-ipc-contract
