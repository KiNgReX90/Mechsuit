---
id: terminal-perf
title: Terminal Performance — Input Lag, Cursor Drift & Misrouted Input
status: pending
created: 2026-06-18
---

# Intent: Terminal Performance — Input Lag, Cursor Drift & Misrouted Input

## Goal

Make typing into a terminal stay responsive and correctly routed even while many
agent sessions stream output at once across several workspaces. Specifically kill
three coupled symptoms the operator hits today:

1. **Input lag** — keystrokes reach the focused agent late and in bursts.
2. **Cursor drift** — holding a key (e.g. spacebar for voice push-to-talk) makes
   the terminal cursor keep marching, overshooting and continuing after release.
3. **Misrouted input** — typing into terminal A, then clicking terminal B, lands
   the in-flight characters in B instead of A.

All three share one root cause: the webview's single JS main thread is saturated
processing PTY output from every session in every workspace, so the user's input
events queue behind the output flood (and a focus change can slip in between a
keypress and its delivery to the textarea). This intent attacks the saturation
with low-risk, high-confidence levers and hardens the input path, leaving the two
larger structural levers (background-parse gating, Tauri Channel) as measured
follow-ons.

## Users

The single operator (the developer running mechsuit) driving many concurrent
agent/terminal sessions across several directories. Under real load — several
`claude` TUIs working at once across 4+ workspaces — the focused terminal becomes
laggy and unreliable to type into, which is the app's core interaction.

## Problem

Everything in the hot path runs on the single webview main thread, and **all**
`session://output` from **all** sessions in **all** workspaces flows through it
continuously:

- xterm uses the **DOM renderer** (the slowest) — `package.json` has only
  `@xterm/addon-fit`, no canvas/webgl renderer addon. Heavy output on the focused
  pane does expensive per-frame DOM work that competes with input handling.
- `terminalPool` routes every output chunk to its pooled xterm regardless of
  visibility (`src/lib/terminalPool.ts:88`), so **background-workspace terminals
  still VT-parse their full stream on the main thread**.
- Output fans out per chunk to multiple always-on subscribers with **no frontend
  coalescing**: `terminalPool` write + `statusEngine` (`src/App.tsx:181`) run per
  chunk per session (`subagentEngine` too when the graph is open). The Rust side
  already coalesces reads into 64 KB (`src-tauri/src/pty/mod.rs:125`), but a
  chatty child still emits many events.
- `Grid` subscribes to the **entire** `statusBySession` object
  (`src/components/Workspace/Grid.tsx:69`), so any session's status transition
  re-renders the whole grid and reconciles every tile.
- Under that jank, buffered keystrokes get dispatched to whichever xterm textarea
  holds DOM focus *after* a click — the misrouting bug.

The team already did real work here (64 KB read coalescing, a single shared
output subscription, a no-op status-store guard, bounded engine buffers); what
remains is the renderer choice, the broad re-render, and the input race.

## Success Criteria

- The focused terminal stays responsive to typing while several other sessions
  stream heavy output across multiple workspaces — no visible keystroke lag.
- Holding a key no longer makes the cursor overshoot or keep drifting after
  release beyond normal terminal echo.
- Typing into one terminal then clicking another never delivers the in-flight
  characters to the second terminal.
- xterm renders the visible panes through a canvas (GPU-free 2D) renderer rather
  than the DOM renderer; the renderer is attached only to visible panes so the
  pool of background terminals does not hold N renderer contexts.
- `session://output` is coalesced on the frontend (batched per animation frame)
  before being written to xterm, so a burst of small chunks becomes one write.
- A session's status transition re-renders only that session's tile, not the
  whole grid.
- No regression: full scrollback survives a workspace switch (pooled instances
  are still reused, never disposed/re-spawned on switch); existing behavior of
  focus, status borders, paused dimming, and close is unchanged.
- `npm run build`, `npm test`, and `cargo test --manifest-path src-tauri/Cargo.toml`
  all pass (the configured finalize gate).

## Constraints

- Stack: Tauri v2 (Rust) backend + React/TypeScript (Vite) frontend + xterm.js
  5.5. Follow the existing event-driven patterns (`uiStore`, `sessionsStore`,
  `statusStore`, `ipc/events`, `terminalPool`).
- **Reuse the terminal pool**: switching workspaces must keep re-parenting the
  existing pooled xterm instances (scrollback intact) — never dispose or re-spawn
  a live terminal. The renderer-addon lifecycle must respect this: attach on
  acquire/visible, dispose on release/detach, without tearing down the xterm
  instance itself.
- Renderer choice: prefer `@xterm/addon-canvas` (2D canvas) over
  `@xterm/addon-webgl` — WebGL has a browser context limit (~16 live contexts),
  and mechsuit can have more terminals than that; canvas has no such hard cap.
  If webgl is used at all, it must be attached only to currently-visible panes.
- Coalescing must not drop or reorder bytes, and must not break the UTF-8
  boundary alignment already done in the Rust reader (`Utf8Stream`).
- Verification is **headless only** — no GUI on the active display; off-screen
  Xvfb only. Do **not** restart the app or kill live PTY sessions to verify
  (restarting kills the operator's live agents). Build, let the operator relaunch.

## Notes

- **Out of scope for this intent (deliberate, measured follow-ons):**
  - **B — Background-parse gating.** Stop VT-parsing terminals whose workspace is
    not visible: buffer their raw bytes (or repaint from the Rust-side scrollback
    /vt100 screen snapshot the registry already keeps) and replay on re-attach.
    This is the real fix for the "many sessions across many *workspaces*" scaling,
    but it is medium-high risk (must preserve instant live re-show) and touches
    the same `terminalPool` write path — so do it as a focused follow-on **after
    measuring** whether the renderer + coalescing wins already make load
    acceptable.
  - **D — Tauri Channel for output.** Move `session://output` off the global event
    bus onto a Tauri v2 `Channel<T>` to cut per-chunk serialization/broadcast
    overhead (`src-tauri/src/pty/mod.rs:193`). Backend + frontend change; higher
    surface area. Follow-on.
- The misrouting bug is primarily a *symptom* of the jank: fixing the renderer +
  coalescing should largely eliminate it. The input-routing work item adds
  deterministic safeguards (focus on pointerdown to shrink the race window;
  non-focused panes do not forward input) and a verification that it no longer
  reproduces, rather than claiming a standalone deterministic cure.
- A separate, unrelated issue lives in `pause-fail-handoff.md` (SIGCONT killing
  resumed TUIs). It is NOT part of this intent.
