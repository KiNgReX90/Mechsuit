---
id: wi-01-renderer-coalesce
title: Fast canvas renderer on visible panes + per-frame output coalescing
intent: terminal-perf
kind: architecture
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-18
---

# Work Item: Fast canvas renderer on visible panes + per-frame output coalescing

## Description

Replace xterm's default DOM renderer with the canvas renderer for visible panes,
and coalesce `session://output` chunks per animation frame before writing them to
xterm. These are the two highest-confidence levers against main-thread saturation
and both live in the terminal pool's output/render path, so they ship together.

1. **Canvas renderer, visible-only.** Add `@xterm/addon-canvas` and load it onto a
   pane's xterm when the pane is acquired (its surface is attached to a visible
   container), and dispose the renderer addon on release (detach) — WITHOUT
   disposing the xterm instance itself, so the pool's "re-parent live instance,
   scrollback intact" contract still holds. Prefer canvas over webgl: WebGL caps
   live contexts (~16) per page and mechsuit can exceed that; the 2D canvas
   renderer has no such hard cap. (If webgl is ever used, it MUST be attached only
   to currently-visible panes and disposed on detach.)

2. **Per-frame output coalescing.** In the pool's single shared `session://output`
   subscription, accumulate incoming chunks per session and flush them to
   `term.write()` once per `requestAnimationFrame` (concatenated in arrival
   order), instead of calling `term.write()` synchronously on every event. A burst
   of small chunks becomes one write. Bytes must not be dropped or reordered, and
   nothing here may re-split a UTF-8 sequence (the Rust reader already aligns on
   UTF-8 boundaries via `Utf8Stream`, so chunks arrive whole — just concatenate
   strings, never slice mid-string). Flush any pending buffer for a session when
   it is disposed, and cancel the scheduled frame when the pool empties.

This work item does not touch the `statusEngine` / `subagentEngine` subscriptions
(they read the same stream independently and are comparatively cheap); narrowing
those is out of scope here.

## Acceptance Criteria

- [ ] `@xterm/addon-canvas` is a dependency and is loaded onto each visible pane's
      xterm; the DOM renderer is no longer the active renderer for visible panes.
- [ ] The renderer addon is attached on `acquireTerminal` and disposed on
      `releaseTerminal`, while the xterm instance + scrollback survive a detach
      (workspace switch re-parents the same instance with no flicker/clear).
- [ ] Incoming `session://output` is buffered per session and flushed to
      `term.write()` once per animation frame; output is byte-exact and in order
      (no dropped/reordered/half-split data).
- [ ] Pending buffers flush/cancel correctly on `disposeTerminal` and when the
      pool empties (no leaked rAF callback, no write-after-dispose).
- [ ] Existing `terminalPool` behavior is preserved: single shared output
      subscription, route-by-sessionId, focus, fit/resize.
- [ ] `npm test` passes (incl. updated `terminalPool` tests); `npm run build`
      passes.

## Execution Manifest

context:
  required:
    - path: src/lib/terminalPool.ts
      reason: owns the xterm pool, the shared session://output subscription, and acquire/release lifecycle — all edits land here
    - path: package.json
      reason: add the @xterm/addon-canvas dependency
  patterns:
    - path: src/lib/terminalPool.ts
      reason: follow the existing FitAddon load (term.loadAddon) and the ensureOutputSubscription/route-by-id pattern already in this file
    - path: src/components/Terminal/Terminal.tsx
      reason: shows the acquire-on-mount / release-on-unmount contract the renderer lifecycle must respect
    - path: src-tauri/src/pty/mod.rs
      reason: reader thread's Utf8Stream/64 KB coalescing — confirms chunks arrive UTF-8-aligned, so frontend coalescing only concatenates, never slices
  tests:
    - path: src/lib/terminalPool.test.ts
      reason: existing pool tests (subscription armed once, route-by-id, dispose); extend for renderer attach/detach and per-frame flush
ownership:
  editable:
    - src/lib/terminalPool.ts
    - src/lib/terminalPool.test.ts
    - package.json

## Technical Notes

- `requestAnimationFrame` is absent in jsdom; guard the flush scheduler so tests
  can drive it deterministically (e.g. fall back to a microtask/`queueMicrotask`
  or an injectable scheduler, and/or expose a flush for tests). Mirror how the
  existing pool tests already stub `onSessionOutput` and flush microtasks.
- Canvas addon import: `import { CanvasAddon } from "@xterm/addon-canvas";` then
  `term.loadAddon(new CanvasAddon())` after `term.open(surface)`. Keep one addon
  instance per entry so it can be disposed on release; re-create on re-acquire.
- Do NOT await `term.write()` per chunk; the coalesced flush should issue a single
  `term.write(concatenated)` per session per frame.
- `package-lock.json` will change from adding the dependency; that is expected.

## Dependencies

(none)
