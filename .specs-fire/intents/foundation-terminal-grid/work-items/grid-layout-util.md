---
id: grid-layout-util
title: Grid tiling utility — top-row-heavy two-row layout
intent: foundation-terminal-grid
kind: behavior
complexity: low
mode: autopilot
status: pending
depends_on: [project-init]
created: 2026-06-16T04:45:28Z
---

# Work Item: Grid tiling utility — top-row-heavy two-row layout

## Description

A pure, dependency-free utility that computes the grid tiling arrangement for N sessions per
the user's rule: a single session fills the screen; otherwise sessions split across TWO rows
with the extra tile(s) on the TOP row when the count is uneven. Returns the per-row tile
counts (top row first) that the workspace renderer consumes. Fully unit-tested.

## Acceptance Criteria

- [ ] `src/lib/gridLayout.ts` exports `computeGridLayout(n: number): { rows: number[] }`.
- [ ] Rule: `n <= 0 → { rows: [] }`; `n === 1 → { rows: [1] }`; otherwise `{ rows: [Math.ceil(n/2), Math.floor(n/2)] }` (top row = ceil).
- [ ] Verified examples: 1 → [1]; 2 → [1,1]; 3 → [2,1]; 4 → [2,2]; 5 → [3,2]; 6 → [3,3]; 7 → [4,3]; 9 → [5,4].
- [ ] Invariant tested: rows sum to n; top row ≥ bottom row; at most two rows for n ≥ 2.
- [ ] `src/lib/gridLayout.test.ts` covers the above; `npm test` passes.

## Team Execution Manifest

context:
  required:
    - path: .specs-fire/intents/foundation-terminal-grid/brief.md
      reason: the exact tiling rule and worked examples (1, 4, 5, 9)
    - path: package.json
      reason: Vitest test setup available from project-init
  patterns:
    - path: .specs-fire/intents/foundation-terminal-grid/brief.md
      reason: success criteria describe the top-row-heavy distribution to implement
  tests:
    - path: src/lib/gridLayout.test.ts
      reason: created here; Vitest unit tests over the layout rule
ownership:
  editable:
    - src/lib/gridLayout.ts
    - src/lib/gridLayout.test.ts

## Technical Notes

Pure function, no React, no IPC — the most parallel-friendly slice (depends only on the test
harness from project-init). The user specified exactly TWO rows for n ≥ 2 (e.g. 9 → 5/4, NOT
3×3); implement that literal rule. Richer multi-row layouts for very large n can be a later
refinement and are out of scope here.

## Dependencies

- project-init
