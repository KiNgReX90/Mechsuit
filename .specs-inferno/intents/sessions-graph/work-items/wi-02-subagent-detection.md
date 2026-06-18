---
id: wi-02-subagent-detection
title: Subagent detection from the PTY output stream
intent: sessions-graph
kind: architecture
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-17
---

# Work Item: Subagent detection from the PTY output stream

## Description

New FRONTEND subsystem that detects Claude Code subagents per live session
directly from the PTY output stream the status engine already consumes — no
backend, no transcript files, no new Tauri event. A pure parser
(`src/lib/subagentParser.ts`, mirroring `statusParser.ts`) recognizes Claude
Code's Task/subagent render markers in ANSI-stripped output; a sibling engine
(`src/state/subagentEngine.ts`, mirroring `statusEngine.ts`) owns a single
subscription to `session://output` / `session://exit`, accumulates each session's
live (one-level) subagent list, derives each subagent's `SessionStatus`, and
writes a passive `subagentStore` keyed by sessionId. Because the stream is keyed
by sessionId, subagents are attributed exactly even when multiple sessions share
one cwd / intent worktree. Degrade gracefully: plain-shell / non-Claude output
yields no subagents.

**A design doc (`wi-02-subagent-detection-design.md`) precedes implementation** —
it settles the Task-marker heuristics, the one-level depth, and the status
mapping. Build to the approved design.

## Acceptance Criteria

- [ ] For a session whose PTY runs Claude Code, subagents (Task invocations) are detected from its `session://output` stream and exposed via `subagentStore` keyed by that sessionId.
- [ ] Each subagent reports an `id`, a `label` (the subagent type / task description when the render exposes it, else `"subagent"`), and a `SessionStatus` (running→`working`, finished→`ready`, failed→`error`).
- [ ] Attribution is per-session by construction (the stream is keyed by sessionId): two sessions in the same cwd / intent worktree never cross-attribute.
- [ ] Subagents appear when a Task starts and clear when it finishes; `subagentStore` clears a session entirely on `session://exit`.
- [ ] The parser degrades gracefully: plain-shell / unknown output and ANSI noise never produce false subagents and never throw.
- [ ] `src/lib/subagentParser.ts` is pure (no timers/IO, like `statusParser.ts`); the engine owns the subscription/teardown; the store stays passive. Unit tests cover parser detection + status mapping, the store actions, and the engine (synthetic output → store, clear on exit); `npm test` + `npm run build` pass.

## Execution Manifest

context:
  required:
    - path: src/state/statusEngine.ts
      reason: the single-subscription engine to mirror — owns the session://output/exit listeners + bounded trailing buffer + teardown
    - path: src/lib/statusParser.ts
      reason: the pure ANSI-stripping regex-parser to mirror (stripAnsi + small commented pattern set; degrade gracefully)
    - path: src/state/statusStore.ts
      reason: the passive zustand store (state + actions only, keyed by sessionId) to mirror
    - path: src/ipc/events.ts
      reason: onSessionOutput / onSessionExit — the streams to consume; NO new event is added
    - path: src/types/index.ts
      reason: SessionStatus union + OutputEvent shape; add the SubagentNode type here
  patterns:
    - path: src/lib/statusParser.ts
      reason: stripAnsi + a small, well-commented regex set; never emit false positives on plain-shell output
    - path: src/state/statusEngine.ts
      reason: subscribe-once + resolve-unlisten + full teardown lifecycle
    - path: src/state/statusStore.ts
      reason: zustand state + actions keyed by sessionId
  tests:
    - path: src/state/statusStore.test.ts
      reason: passive-store test convention to mirror
    - path: src/state/statusEngine.test.ts
      reason: engine test convention (feed synthetic output, assert store writes, assert teardown)
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/lib/subagentParser.ts
    - src/lib/subagentParser.test.ts
    - src/state/subagentEngine.ts
    - src/state/subagentEngine.test.ts
    - src/state/subagentStore.ts
    - src/state/subagentStore.test.ts
    - src/types/index.ts

## Technical Notes

Claude Code renders a subagent as a Task tool block (e.g. a `● Task(…)` header
with a `⎿ Running… / Done` line); recognize these in ANSI-stripped output and key
them by sessionId. Only ONE level is observable — a parent terminal never renders
a subagent's own subagents (those run in the subagent's isolated context), which
matches the intent's `session → subagent` model. Subagents realistically exhibit
`working` / `ready` / `error`; `awaiting-approval` is a main-session state, not a
subagent state. The engine is STARTED by the graph liveness layer (wi-04) — export
both a plain `startSubagentEngine(): () => void` and a `useSubagentEngine()` /
`<SubagentEngine/>` wrapper, like `statusEngine`. Operate on a bounded trailing
buffer like `statusEngine` — never accumulate the whole stream. Overlaps wi-01
ONLY on `src/types/index.ts` (both add one TS type — serialized by the
orchestrator); everything else is disjoint and fully parallel.

## Dependencies

(none)
