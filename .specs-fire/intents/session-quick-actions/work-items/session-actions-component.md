---
id: session-actions-component
title: SessionActions component — per-session icon action group (clear/compact/expand/close)
intent: session-quick-actions
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T06:09:19Z
---

# Work Item: SessionActions component — per-session icon action group (clear/compact/expand/close)

## Description

Create a new presentational `SessionActions` component: a compact group of **icon** buttons
that live in a session tile's header. Four actions, all scoped to one session id:

- **Clear** — refresh-style icon — sends `/clear` + Enter to the session via
  `writeSession(sessionId, "/clear\r")` (direct call, matching `Terminal.tsx`).
- **Compact** — box / package-style icon — sends `writeSession(sessionId, "/compact\r")`.
- **Expand / Collapse** — fullscreen-style icon — fires a callback to the parent (the parent
  owns expand state in `uiStore`). When `isExpanded` is false it is an **Expand** control;
  when true it is a **Collapse** control.
- **Close** — × icon — fires an `onClose(sessionId)` callback (the parent kills the session
  and clears UI state; this component does not touch the store).

Buttons are **icons, not words** (per the user's decision). Use inline SVGs or clean glyphs
with accessible labels — no new icon dependency. Clear is a refresh icon; Compact is a
box/package icon; Expand is a fullscreen/arrows icon; Close is an ×.

This component is presentational and independently unit-tested. Clear/Compact call
`writeSession` directly (so they are testable in isolation against the mocked ipc layer);
Expand/Collapse/Close are callbacks because they mutate parent-owned state.

## Acceptance Criteria

- [ ] `SessionActions` renders four icon buttons; each button has an accessible label.
- [ ] aria-labels are **exactly**: `Clear session ${sessionId}`, `Compact session ${sessionId}`, `Close session ${sessionId}`, and the expand control reuses the existing names — `Expand session ${sessionId}` when not expanded and `Collapse session` when expanded — so the existing Workspace tests keep matching.
- [ ] Clicking **Clear** calls `writeSession(sessionId, "/clear\r")`; clicking **Compact** calls `writeSession(sessionId, "/compact\r")`.
- [ ] Clicking **Expand** calls the expand callback with the session id; in the expanded variant, clicking **Collapse** calls the collapse callback.
- [ ] Clicking **Close** calls `onClose(sessionId)`.
- [ ] Every button calls `e.stopPropagation()` so clicking it does not bubble to the tile's focus `onClick` (match the existing expand button in `Grid.tsx`).
- [ ] Icon-button styling added to `Workspace.css` (a `.session-action` class or similar); buttons read as a horizontal icon row in the tile header.
- [ ] `SessionActions.test.tsx` (RTL + Vitest, ipc mocked) covers: Clear/Compact call `writeSession` with the right command + session id; Expand/Collapse/Close fire their callbacks; clicks stop propagation.

## Team Execution Manifest

context:
  required:
    - path: src/ipc/commands.ts
      reason: writeSession (clear/compact) and killSession signatures
    - path: src/components/Workspace/Grid.tsx
      reason: existing expand button in the tile header — pattern for stopPropagation + aria-label to preserve
    - path: src/components/Workspace/Workspace.css
      reason: tile-header / button styles to extend with icon-button styling
    - path: src/components/Workspace/index.ts
      reason: barrel export to add SessionActions to (optional, for the wiring item)
  patterns:
    - path: src/components/Workspace/ActionBar.tsx
      reason: presentational button-group component pattern (props, className, aria-label)
    - path: src/components/Terminal/Terminal.tsx
      reason: direct writeSession call pattern
  tests:
    - path: src/components/Terminal/Terminal.test.tsx
      reason: pattern for mocking ipc commands and asserting writeSession calls
ownership:
  editable:
    - src/components/Workspace/SessionActions.tsx
    - src/components/Workspace/SessionActions.test.tsx
    - src/components/Workspace/Workspace.css
    - src/components/Workspace/index.ts

## Technical Notes

Submit sequence is **carriage return `\r`** — xterm's `onData` delivers Enter as `\r` and the
PTY input path forwards raw bytes (see `Terminal.test.tsx`), so `/clear\r` / `/compact\r` is
the correct sequence; do NOT use `\n`.

Preserve the existing accessible names for expand/collapse — the foundation
`Workspace.test.tsx` matches `getByRole("button", { name: "Expand session a" })` and
`{ name: "Collapse session" }`. The wiring item replaces the old inline buttons with this
component, so the names must survive the swap.

Keep this component presentational: no `uiStore`/`sessionsStore` imports. Clear/Compact use
`writeSession` directly; everything that mutates parent state is a callback.

## Dependencies

(none)
