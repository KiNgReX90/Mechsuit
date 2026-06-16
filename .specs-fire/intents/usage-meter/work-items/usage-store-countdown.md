---
id: usage-store-countdown
title: Usage store + format helpers — usageStore, countdown formatter, color-threshold level
intent: usage-meter
kind: feature
complexity: low
mode: autopilot
status: pending
depends_on: [usage-ipc-contract]
created: 2026-06-16T14:36:19Z
---

# Work Item: Usage store + format helpers — usageStore, countdown formatter, color-threshold level

## Description

The pure state + presentation logic the footer bar consumes — no rendering. Two files, both
unit-tested with Vitest (mirroring `relativeTime.ts` + its test).

- `src/state/usageStore.ts` — a small zustand store holding the latest usage:
  ```ts
  { snapshot: UsageSnapshot | null; error: string | null; lastUpdated: number | null;
    applyUpdate(u: UsageUpdate): void; }
  ```
  `applyUpdate` sets `snapshot`/`error` from a `UsageUpdate` and stamps `lastUpdated`. Follow the
  existing `*Store.ts` zustand convention.
- `src/lib/usageFormat.ts` — pure helpers:
  - `formatCountdown(resetsAt: string, now?: number): string` — time **until** the reset, parsed
    from the RFC3339 string via native `Date`: e.g. `"2h13m"`, `"6d"`, `"12m"`, `"<1m"`; a
    past/now timestamp → `"now"`. (Note: this is "time until", distinct from `relativeTime`'s
    "time ago".)
  - `usageLevel(utilization: number): "ok" | "warn" | "crit"` — color-threshold mapping with
    named constants (default `warn` ≥ 75, `crit` ≥ 90).

## Acceptance Criteria

- [ ] `usageStore` exposes `snapshot`, `error`, `lastUpdated`, and `applyUpdate`; `applyUpdate`
      correctly reflects both the success (`snapshot` set, `error` null) and failure
      (`error` set, `snapshot` null) shapes of `UsageUpdate`.
- [ ] `formatCountdown` returns the documented compact strings for minute/hour/day ranges and
      `"now"` for past/near-now resets; pure (accepts an injectable `now`).
- [ ] `usageLevel` returns `ok`/`warn`/`crit` at the documented thresholds (boundaries
      inclusive) via named constants.
- [ ] Vitest unit tests cover `formatCountdown` ranges, `usageLevel` boundaries, and
      `applyUpdate` for both update shapes.
- [ ] `npm test` and `npm run build` pass.

## Team Execution Manifest

context:
  required:
    - path: src/types/index.ts
      reason: UsageSnapshot / UsageWindow / UsageUpdate types these consume (from usage-ipc-contract)
    - path: src/lib/relativeTime.ts
      reason: pure compact-time-formatting + named-threshold convention to mirror (this is the "until" counterpart)
    - path: src/state/statusStore.ts
      reason: zustand store shape/convention to mirror for usageStore
  patterns:
    - path: src/lib/relativeTime.test.ts
      reason: Vitest table-style test convention for a pure formatter
    - path: src/state/statusStore.test.ts
      reason: store test convention
  tests:
    - path: src/lib/relativeTime.test.ts
      reason: mirror this test style for usageFormat.test.ts
    - path: src/state/statusStore.test.ts
      reason: mirror for usageStore.test.ts
ownership:
  editable:
    - src/state/usageStore.ts
    - src/lib/usageFormat.ts

## Technical Notes

Low-complexity, pure logic. Keep `formatCountdown` and `usageLevel` side-effect-free and
`now`-injectable so they test deterministically without faking timers. Thresholds and the
day/hour/minute cutoffs are named constants. No React, no rendering, no IPC calls here — the
component item wires these to the live event stream.

## Dependencies

- usage-ipc-contract
