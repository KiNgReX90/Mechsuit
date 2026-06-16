---
id: status-parser
title: Status parser — agent-agnostic approval/error heuristics
intent: session-status-engine
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: [status-model-store]
created: 2026-06-16T05:59:44Z
---

# Work Item: Status parser — agent-agnostic approval/error heuristics

## Description

Implement the pure, side-effect-free output heuristics in `src/lib/statusParser.ts` that the
status engine calls. No timers, no subscriptions, no store access — just functions over
strings. Two detectors plus one idle-classifier:
- `matchesApprovalPrompt(text)` — trailing-output approval-prompt detection (Claude Code CLI
  first; agent-agnostic).
- `matchesError(text)` — known error-text patterns.
- `classifyIdle(trailingText): "ready" | "awaiting-approval"` — applied by the engine when a
  session goes quiet: returns `awaiting-approval` when the trailing output matches an approval
  prompt, otherwise `ready`.

Heuristics must DEGRADE GRACEFULLY for unknown agents / plain shells — when in doubt, never
emit a false `awaiting-approval` (default to `ready` on idle).

## Acceptance Criteria

- [ ] `matchesApprovalPrompt(text: string): boolean` detects common approval prompts: Claude Code style numbered "❯ 1. Yes / 2. No" choice menus, "Do you want to proceed?", and generic `(y/n)` / `[Y/n]` confirmations. Case-insensitive where sensible.
- [ ] `matchesError(text: string): boolean` detects common error signatures (e.g. `Error:`/`error:` lines, `panic`, `Traceback (most recent call last)`, `command not found`, `fatal:`) without firing on the word "error" appearing incidentally mid-sentence where avoidable.
- [ ] `classifyIdle(trailingText: string): SessionStatus` returns `"awaiting-approval"` when `matchesApprovalPrompt` is true, else `"ready"`; never throws on empty/garbage input.
- [ ] Functions are PURE: deterministic, no module-level mutable state, no I/O, no `Date.now`.
- [ ] Graceful degradation: plain-shell output (e.g. a bare `$`/`%` prompt, `ls` output) does NOT match approval; ANSI escape codes in the input do not break matching (strip or tolerate them).
- [ ] Vitest unit tests cover: positive + negative cases for each detector, ANSI-laden input, empty string, and the plain-shell no-false-approval case.

## Team Execution Manifest

context:
  required:
    - path: src/lib/statusParser.ts
      reason: create here — the pure heuristics module
    - path: src/types/index.ts
      reason: import SessionStatus (defined by status-model-store) for classifyIdle's return type
  patterns:
    - path: src/lib/gridLayout.ts
      reason: existing pure src/lib utility — file layout, export, and JSDoc style to follow
  tests:
    - path: src/lib/gridLayout.test.ts
      reason: pure-function Vitest pattern (describe/it/expect, table of cases) to mirror
ownership:
  editable:
    - src/lib/statusParser.ts
    - src/lib/statusParser.test.ts

## Technical Notes

Per the resolved product decision (2026-06-16): there is NO time-based error — `error` comes
only from a non-zero exit code (handled by the engine, not here) or `matchesError` patterns.
The idle/quiet detection itself (the ~2s debounce) lives in the `status-engine` item; this
module only classifies the trailing text it is handed. Keep the regex set small and
well-commented; this is the primary place future agents' prompt styles get added. Strip ANSI
(`\x1b\[[0-9;]*m` and friends) before matching, or write patterns tolerant of them — agent
CLIs emit heavily styled output.

## Dependencies

- status-model-store
