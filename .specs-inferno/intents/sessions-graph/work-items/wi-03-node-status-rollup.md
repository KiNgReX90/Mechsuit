---
id: wi-03-node-status-rollup
title: Node status + pulse roll-up lib
intent: sessions-graph
kind: behavior
complexity: low
mode: autopilot
status: pending
depends_on: []
created: 2026-06-17
---

# Work Item: Node status + pulse roll-up lib

## Description

Pure, dependency-free TypeScript module `src/lib/nodeStatus.ts` providing the
graph's visual status logic, with a colocated vitest test. Two functions:

1. `pulseFor(status)` → a pulse descriptor `{ color, pulsing }`: working→green
   (pulsing), awaiting-approval→orange (pulsing), ready→gray (NOT pulsing),
   error→red (pulsing).
2. `rollupStatus(statuses[])` → the highest-precedence status using worst-wins
   precedence `error > awaiting-approval > working > ready`; empty input → `ready`.

No React, no IPC — just functions + types over the existing `SessionStatus`.

## Acceptance Criteria

- [ ] `pulseFor` returns the correct color + `pulsing` boolean for all four statuses (ready has `pulsing: false`).
- [ ] `rollupStatus` returns the highest-precedence status by `error > awaiting-approval > working > ready`; empty array returns `ready`.
- [ ] Module is pure — imports nothing beyond the `SessionStatus` type — and is fully covered by `src/lib/nodeStatus.test.ts`.
- [ ] `npm test` passes and `npm run build` typechecks.

## Execution Manifest

context:
  required:
    - path: src/types/index.ts
      reason: the SessionStatus union the functions operate on
    - path: src/lib/statusParser.ts
      reason: pattern for a pure lib living in src/lib
  patterns:
    - path: src/lib/statusParser.ts
      reason: pure-function module convention
    - path: src/lib/statusParser.test.ts
      reason: colocated vitest test convention to mirror
  tests:
    - path: src/lib/statusParser.test.ts
      reason: test style to follow
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/lib/nodeStatus.ts
    - src/lib/nodeStatus.test.ts

## Technical Notes

`color` should be a stable token the view's CSS keys off (e.g. `green` | `orange`
| `gray` | `red`), not a hex value — keep concrete styling in wi-06. Precedence
order is a product decision (surface errors first, then work waiting on the user);
it is centralized here so the view never re-derives it.

## Dependencies

(none)
