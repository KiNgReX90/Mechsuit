---
id: wi-03-input-routing-hardening
title: Harden input routing so keystrokes never land in the wrong session
intent: terminal-perf
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: [wi-01-renderer-coalesce, wi-02-scoped-status-subscriptions]
created: 2026-06-18
---

# Work Item: Harden input routing so keystrokes never land in the wrong session

## Description

Add deterministic safeguards so typing into terminal A, then clicking terminal B,
can never deliver A's in-flight characters to B. The dominant cause of this bug is
main-thread jank (addressed by wi-01) widening the window between a keypress and
its delivery to the textarea, during which a click moves DOM focus; this item adds
the belt-and-suspenders so it cannot happen even under residual load.

Two concrete, low-risk safeguards:

1. **Switch focus on pointer-down, not click.** A tile should claim focus as early
   in the input sequence as possible. Move the focus-on-tile action from `onClick`
   to `onPointerDown` (keep click as a fallback / no double-fire) so DOM focus
   lands on the target terminal before any subsequent input is processed, shrinking
   the race window.

2. **Non-focused panes do not forward input.** In the pool's `term.onData`
   handler, forward to the PTY only when this session is the current
   focused/expanded session (read live from `uiStore`). A pane that is not the
   active one drops stray input instead of writing it to its agent — so misrouted
   characters are never injected into a background agent session. (Dropping a few
   stray characters is strictly safer than typing into the wrong live agent.)
   This composes with the existing capture-phase keydown swallowing in `Grid`.

Depends on wi-01 and wi-02 because it edits the same files
(`src/lib/terminalPool.ts`, `src/components/Workspace/Grid.tsx`); run it after
them so it builds on their final shape rather than colliding.

This item must end with a short manual verification note (headless reasoning is
fine — do NOT launch the GUI on the active display) describing how to reproduce
the original misroute and confirming the safeguards prevent it.

## Acceptance Criteria

- [ ] Tile focus is claimed on `onPointerDown` (click no longer the sole trigger),
      without double-invoking focus or breaking existing click-to-focus tests.
- [ ] `terminalPool`'s `onData` forwards input only for the active
      (focused, or expanded) session; a non-active pane does not write stray input
      to its PTY.
- [ ] Typing into one terminal then clicking another no longer routes the
      in-flight characters to the second terminal (documented repro + reasoning).
- [ ] Existing focus behavior is intact: click-to-focus, Shift+Arrow grid
      navigation, expanded-mode switching, and the focused-pane DOM-focus lockstep
      all still work; `markPrompted` on carriage-return still fires for the active
      session.
- [ ] `npm test` passes (incl. `Workspace.navigation` and `terminalPool` suites);
      `npm run build` passes.

## Execution Manifest

context:
  required:
    - path: src/lib/terminalPool.ts
      reason: term.onData → writeSession is the input forward point to gate on the active session
    - path: src/components/Workspace/Grid.tsx
      reason: tile focus trigger (onClick → onPointerDown) and capture-phase key handling
    - path: src/lib/focusSession.ts
      reason: the single focus routine (sets focusedSessionId + grabs DOM focus); align the pointer-down path with it
  patterns:
    - path: src/components/Workspace/useGridNavigation.ts
      reason: capture-phase listener + reads live store state imperatively — the pattern for live focus checks
    - path: src/state/uiStore.ts
      reason: focusedSessionId / expandedSessionId — the source of truth for "the active session"
    - path: src/components/Terminal/Terminal.tsx
      reason: the focused-pane DOM-focus lockstep effect the safeguards must stay consistent with
  tests:
    - path: src/components/Workspace/Workspace.navigation.test.tsx
      reason: focus/navigation behavior tests to extend for pointer-down focus and input gating
    - path: src/lib/terminalPool.test.ts
      reason: onData routing tests — assert non-active panes do not forward input
ownership:
  editable:
    - src/lib/terminalPool.ts
    - src/components/Workspace/Grid.tsx
    - src/lib/focusSession.ts
    - src/lib/terminalPool.test.ts
    - src/components/Workspace/Workspace.navigation.test.tsx

## Technical Notes

- Read `uiStore` state imperatively inside `onData`
  (`useUiStore.getState()`), as `useGridNavigation` does, so the handler always
  sees live focus without re-subscribing.
- "Active session" = `expandedSessionId` when set and valid, else
  `focusedSessionId`. Forward input only when `sessionId` matches it.
- Keep the safeguard from breaking the Commander terminal and any single-pane
  expanded view (where the one pane is always the active one).
- This is a safety net; the real responsiveness fix is wi-01. Frame the manual
  verification accordingly.

## Dependencies

- wi-01-renderer-coalesce
- wi-02-scoped-status-subscriptions
