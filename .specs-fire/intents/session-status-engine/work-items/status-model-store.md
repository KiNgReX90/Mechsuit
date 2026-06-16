---
id: status-model-store
title: Status model & store — SessionStatus type + per-session statusStore
intent: session-status-engine
kind: architecture
complexity: low
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T05:59:44Z
---

# Work Item: Status model & store — SessionStatus type + per-session statusStore

## Description

Define the shared status contract that the parser, engine, and styling all build on: the
`SessionStatus` union type (in `src/types/index.ts`) and a dedicated zustand `statusStore`
keyed by `sessionId` (in `src/state/statusStore.ts`). The store holds each session's derived
status plus an `acknowledged` flag (for the "ready persists until the user acknowledges"
rule), and exposes the actions other items call: `setStatus`, `acknowledge`, and `clear`.
This is the dependency root — keep it minimal and free of any output-parsing or timer logic
(those live in `status-parser` and `status-engine`).

## Acceptance Criteria

- [ ] `src/types/index.ts` exports `type SessionStatus = "working" | "awaiting-approval" | "ready" | "error"` and an interface for the per-session status record (e.g. `SessionStatusState { status: SessionStatus; acknowledged: boolean }`).
- [ ] `src/state/statusStore.ts` is a zustand store with `statusBySession: Record<string, SessionStatusState>` keyed by `sessionId`, mirroring the zustand idiom used by `uiStore`/`sessionsStore`.
- [ ] `setStatus(sessionId, status)` upserts the session's status; transitioning *to* `ready` resets `acknowledged` to `false` (a fresh ready always re-alerts).
- [ ] `acknowledge(sessionId)` sets `acknowledged: true` for that session without changing its `status` (used when the user focuses/clicks a ready session).
- [ ] `clear(sessionId)` removes a session's entry (so a killed/removed session leaves no stale status).
- [ ] Store contains NO `session://output`/`session://exit` subscription, no timers, and no parsing — purely state + actions.
- [ ] Vitest unit tests cover `setStatus` upsert, the `ready` → `acknowledged:false` reset, `acknowledge`, and `clear`.

## Team Execution Manifest

context:
  required:
    - path: src/state/uiStore.ts
      reason: zustand store idiom to mirror (create, typed State interface, selectors)
    - path: src/types/index.ts
      reason: add the SessionStatus type + status record interface here, next to SessionInfo
  patterns:
    - path: src/state/sessionsStore.ts
      reason: per-session record-keyed zustand store pattern (Record<string, ...> + set updater)
  tests:
    - path: src/state/uiStore.test.ts
      reason: store unit-test pattern (setState/getState assertions) to follow for statusStore.test.ts
ownership:
  editable:
    - src/types/index.ts
    - src/state/statusStore.ts
    - src/state/statusStore.test.ts

## Technical Notes

Status is deliberately a SEPARATE store keyed by `sessionId`, NOT a field added to the
directory-keyed `sessionsStore` (whose shape is `Record<dirPath, SessionInfo[]>`). This keeps
status lookups O(1) by session id for the tiles and avoids churning the directory structure.
Blink lifecycle is handled in CSS by the styling item (a fixed-duration animation that blinks
then settles), so the store does NOT need a `blinkUntil` timestamp — `status: "ready"` +
`acknowledged: false` is the whole "blinking ready, not yet acknowledged" condition. The
`sidebar-status-dots` intent will later read this same store to aggregate per-directory dots.

## Dependencies

(none)
