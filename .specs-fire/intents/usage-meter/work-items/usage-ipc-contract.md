---
id: usage-ipc-contract
title: Usage IPC contract (TS) — UsageSnapshot/UsageWindow/UsageUpdate types, getUsage wrapper, onUsageUpdated subscriber
intent: usage-meter
kind: feature
complexity: low
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T14:36:19Z
---

# Work Item: Usage IPC contract (TS) — UsageSnapshot/UsageWindow/UsageUpdate types, getUsage wrapper, onUsageUpdated subscriber

## Description

Mirror the backend usage contract on the TypeScript side, exactly matching the fixed shape in
the intent brief. This runs **in parallel with `usage-backend`** — both implement the same
agreed contract independently (the same way `rust-ipc-contract` and `ts-ipc-contract` were
siblings).

- `src/types/index.ts` — add:
  ```ts
  export interface UsageWindow { utilization: number; resetsAt: string; } // resetsAt: RFC3339
  export interface UsageSnapshot { fiveHour: UsageWindow; sevenDay: UsageWindow; }
  export interface UsageUpdate { snapshot: UsageSnapshot | null; error: string | null; }
  ```
- `src/ipc/commands.ts` — add `getUsage(): Promise<UsageSnapshot>` wrapping
  `invoke<UsageSnapshot>("get_usage")` (rejects when the backend returns `Err`).
- `src/ipc/events.ts` — add
  `onUsageUpdated(cb: (u: UsageUpdate) => void): Promise<UnlistenFn>` subscribing to the
  `usage://updated` event (follow the existing `onCommanderDirectoriesChanged` / `onSessionOutput`
  shape).

No behavior beyond the typed wrappers; keep doc-comments consistent with the existing entries.

## Acceptance Criteria

- [ ] `UsageWindow`, `UsageSnapshot`, `UsageUpdate` exported from `src/types/index.ts`, camelCase
      fields matching the Rust serde output (`fiveHour`, `sevenDay`, `resetsAt`).
- [ ] `getUsage()` added to `src/ipc/commands.ts`, typed `Promise<UsageSnapshot>`, invoking
      `"get_usage"`.
- [ ] `onUsageUpdated()` added to `src/ipc/events.ts`, listening on `usage://updated`, returning
      an unlisten function.
- [ ] `npm run build` (tsc) passes.

## Team Execution Manifest

context:
  required:
    - path: src/types/index.ts
      reason: add the usage types alongside the existing camelCase IPC mirrors (single-owner)
    - path: src/ipc/commands.ts
      reason: add getUsage wrapper following the typed invoke<T> pattern (single-owner)
    - path: src/ipc/events.ts
      reason: add onUsageUpdated subscriber following the listen<T>/UnlistenFn pattern (single-owner)
  patterns:
    - path: src/ipc/events.ts
      reason: onCommanderDirectoriesChanged / onSessionOutput subscriber shape to mirror
    - path: src/ipc/commands.ts
      reason: typed invoke<T> wrapper shape to mirror
  tests: []
ownership:
  editable:
    - src/types/index.ts
    - src/ipc/commands.ts
    - src/ipc/events.ts

# Cross-language string-contract parity: the event name is an untyped string on both sides, so a
# typo compiles and typechecks yet silently never fires. The orchestrator runs this at finalize.
finalize_check: "git grep -q 'usage://updated' src-tauri/src/events.rs && git grep -q 'usage://updated' src/ipc/events.ts"

## Technical Notes

Low-complexity, contract-only. The exact field names and event/command names are fixed by the
brief's IPC contract section — match them verbatim so the independently-built Rust side lines
up. No store, no component, no rendering here.

## Dependencies

(none)
