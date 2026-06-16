---
id: status-border-styling
title: Status border styling — per-status tile borders, focus wins, ready blink
intent: session-status-engine
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [status-model-store]
created: 2026-06-16T05:59:44Z
---

# Work Item: Status border styling — per-status tile borders, focus wins, ready blink

## Description

Reflect each session's status as a colored border on its tile, in both the grid view
(`Grid.tsx`) and the expanded view (`Workspace.tsx`), reading status from `statusStore` by
`sessionId`. Add the per-status CSS in `Workspace.css`. Focus (cyan) must WIN over the status
color; a freshly-ready (unacknowledged) tile blinks green briefly then settles to steady
green and holds until acknowledged; awaiting-approval is orange; error is red.

## Acceptance Criteria

- [ ] Each tile (grid tile in `Grid.tsx` and the expanded tile in `Workspace.tsx`) gets a status-derived class from `statusStore.statusBySession[session.id]`, e.g. `workspace-tile--ready` / `--awaiting-approval` / `--error`.
- [ ] FOCUS WINS: when a tile is focused it shows the cyan/accent border (`workspace-tile--focused`) regardless of its status color. The status still lives in the store (the sidebar dots intent reads it).
- [ ] `ready` (unacknowledged) → border BLINKS green for a short period (~3s) via a fixed-duration CSS animation, then settles to steady green and persists; once `acknowledged` is true the green border is removed (back to the neutral default).
- [ ] `awaiting-approval` → orange border; `error` → red border.
- [ ] A session with no status entry, or status `working`, shows the neutral default border (no regression to existing focus behavior).
- [ ] Existing Workspace tests stay green; add coverage that a tile renders the right status class for each status, that `--focused` takes visual precedence, and that an acknowledged ready tile drops the green class.

## Team Execution Manifest

context:
  required:
    - path: src/components/Workspace/Grid.tsx
      reason: grid tile className is assembled here (currently focused/unfocused) — add status class
    - path: src/components/Workspace/Workspace.tsx
      reason: expanded-tile className lives here — add status class for the expanded view
    - path: src/components/Workspace/Workspace.css
      reason: add per-status border rules + the ready blink-then-settle keyframes
    - path: src/state/statusStore.ts
      reason: read statusBySession[sessionId] (selector); status record shape from status-model-store
  patterns:
    - path: src/components/Workspace/Workspace.css
      reason: existing .workspace-tile / .workspace-tile--focused border vars to extend (var(--accent))
  tests:
    - path: src/components/Workspace/Workspace.test.tsx
      reason: extend — RTL pattern with mocked ipc + mocked Terminal, seed statusStore via setState
ownership:
  editable:
    - src/components/Workspace/Grid.tsx
    - src/components/Workspace/Workspace.tsx
    - src/components/Workspace/Workspace.css
    - src/components/Workspace/Workspace.test.tsx

## Technical Notes

This item depends ONLY on `status-model-store` (the `SessionStatus` type + the `statusStore`
selector shape), NOT on the engine — tests seed `statusStore` directly via `setState`, exactly
as the existing Workspace tests seed `sessionsStore`/`uiStore`. That lets it run in PARALLEL
with `status-parser` and the bulk of `status-engine`. Focus precedence: if the existing
`--focused` class can't simply win by CSS source order, keep the focused class and gate the
status class so a focused tile never also carries a status color. The blink is CSS-only — a
fixed-iteration `@keyframes` (e.g. 6 × 0.5s) that ends on the steady-green frame; no JS timer.
Ready persists because the class is driven by `status === "ready" && !acknowledged`, which the
engine only clears on acknowledge.

## Dependencies

- status-model-store
