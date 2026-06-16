---
id: status-engine
title: Status engine — live output→status wiring, idle debounce, ack-on-focus
intent: session-status-engine
kind: architecture
complexity: high
mode: autopilot
status: pending
depends_on: [status-model-store, status-parser]
created: 2026-06-16T05:59:44Z
---

# Work Item: Status engine — live output→status wiring, idle debounce, ack-on-focus

## Description

The reasoning-bearing core: a single global engine that subscribes once to `session://output`
and `session://exit`, derives each session's live status through the parser + an idle debounce,
writes results into `statusStore`, and acknowledges ready sessions when they gain focus.
Implement it as `src/state/statusEngine.ts` (a `useStatusEngine()` hook or a null-rendering
`<StatusEngine/>` component) and mount it ONCE in `src/App.tsx`. It must own all timers and
subscription lifecycle; the store stays passive and the parser stays pure.

State machine per session:
- Output arrives → `setStatus(id, "working")`; (re)start that session's idle timer (default
  2000ms) and append to a small bounded trailing-output buffer.
- If a chunk `matchesError` → `setStatus(id, "error")` immediately (don't wait for idle).
- Idle timer fires → `setStatus(id, classifyIdle(trailingBuffer))` → `ready` or
  `awaiting-approval`.
- `session://exit`: code !== 0 → `error`; code === 0 → `ready`. Clear that session's timer.
- When `uiStore.focusedSessionId` becomes a session whose status is `ready` → `acknowledge(id)`.

## Acceptance Criteria

- [ ] `src/state/statusEngine.ts` subscribes EXACTLY ONCE to `onSessionOutput` and `onSessionExit` (via `src/ipc/events.ts`) and tears both down on unmount — no per-Terminal duplication.
- [ ] Mounted once in `src/App.tsx` (e.g. alongside the shell) so it runs for the whole app regardless of which directory/workspace is shown.
- [ ] Output chunk → status `working` and the idle timer is reset; after the configurable debounce (default 2000ms) with no further output → status becomes `classifyIdle(trailing)` (`ready` or `awaiting-approval`).
- [ ] A chunk matching `matchesError` sets `error` immediately, bypassing the idle wait.
- [ ] `session://exit` with non-zero code → `error`; with zero code → `ready`; the session's pending idle timer is cleared.
- [ ] Focus acknowledges: when `focusedSessionId` changes to a session currently `ready`, the engine calls `acknowledge(id)` (clears the ready alert) — focusing a non-ready session is a no-op.
- [ ] The debounce interval is a single named, easily-overridable constant (configurable).
- [ ] Vitest tests (fake timers, mocked `ipc/events`, mocked/seeded stores) cover: output→working→(debounce)→ready, output whose trailing text is an approval prompt → awaiting-approval, mid-stream error pattern → immediate error, exit code 0 → ready and non-zero → error, and ack-on-focus of a ready session.

## Team Execution Manifest

context:
  required:
    - path: src/ipc/events.ts
      reason: onSessionOutput / onSessionExit subscription helpers to wire into
    - path: src/state/statusStore.ts
      reason: setStatus / acknowledge / clear actions this engine drives (from status-model-store)
    - path: src/lib/statusParser.ts
      reason: matchesError / classifyIdle heuristics this engine applies (from status-parser)
    - path: src/state/uiStore.ts
      reason: focusedSessionId — subscribe to drive ack-on-focus (read-only; do not edit)
    - path: src/App.tsx
      reason: mount point — add the engine once to the app shell
  patterns:
    - path: src/components/Terminal/Terminal.tsx
      reason: existing onSessionOutput subscribe-and-teardown lifecycle pattern (useEffect + unlisten) to follow
  tests:
    - path: src/state/uiStore.test.ts
      reason: store/unit Vitest pattern to mirror; combine with vi.useFakeTimers + vi.mock("../ipc/events")
    - path: src/App.test.tsx
      reason: App smoke test — keep it green after mounting the engine (mock ipc/events so no real Tauri backend is needed)
ownership:
  editable:
    - src/state/statusEngine.ts
    - src/state/statusEngine.test.ts
    - src/App.tsx
    - src/App.test.tsx

## Technical Notes

Keep a SMALL bounded trailing-output buffer per session (e.g. last ~2KB or last N lines) for
`classifyIdle` — never accumulate the whole stream. This engine deliberately does NOT touch
`Terminal.tsx`: Terminal keeps its own per-pane output subscription for rendering; this is an
independent global subscription for status derivation. Reading `uiStore.focusedSessionId`
must not edit `uiStore` (focus is set by the existing Workspace/Grid click handlers). The
blink-then-settle visual is pure CSS in the styling item — the engine only sets `status` /
`acknowledged`, it does not manage blink timing. `App.test.tsx` already mocks the ipc layer;
extend that mock to cover `ipc/events` so mounting the engine doesn't require a real backend.

## Dependencies

- status-model-store
- status-parser
