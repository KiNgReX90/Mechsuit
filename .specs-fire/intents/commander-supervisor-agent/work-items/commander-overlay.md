---
id: commander-overlay
title: Commander overlay — chat window component (markdown, history) over the CommanderEngine
intent: commander-supervisor-agent
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [commander-claude-driver]
created: 2026-06-16T06:17:01Z
---

# Work Item: Commander overlay — chat window component (markdown, history) over the CommanderEngine

## Description

Build the Commander chat overlay under `src/components/Commander/`
(`Commander.tsx`, `Commander.css`, `index.ts`, `Commander.test.tsx`).

- A floating overlay panel (centered/anchored, above the grid): scrollable message list, text
  input + send, close affordance. Visible state is controlled by props (`open` / `onClose`) — the
  hotkey + open-state live in `commander-app-wiring`.
- Renders assistant messages as **markdown** via `react-markdown` (terse output; minimal theming).
  User messages render plain.
- Holds **conversation history** in local component state (an array of `CommanderMessage`) and
  keeps the driver's `sessionId` across turns so one conversation continues; persistence across app
  restarts is out of scope for now.
- Calls Commander through the **`CommanderEngine` interface** from `src/lib/commander/types.ts`
  (passed in as a prop). On submit: append the user message, call `engine.ask(message, sessionId)`,
  store the returned `sessionId`, append the assistant reply, show a pending indicator while
  awaiting. Do NOT import the driver/command directly — tests pass a mock engine.
- Add `react-markdown` to `package.json` dependencies (nothing else edits `package.json` in this
  intent).

## Acceptance Criteria

- [ ] `Commander` renders only when `open` is true; an accessible close control calls `onClose`.
- [ ] Submitting input appends the user message, calls `engine.ask(...)` with the running
      conversation's `sessionId`, stores the returned id, and appends the assistant reply.
- [ ] Assistant messages render through `react-markdown`; a pending indicator shows while a reply
      is in flight and clears when it resolves.
- [ ] Conversation history (and `sessionId`) persist across opens within the session while mounted.
- [ ] The component imports only `src/lib/commander/types.ts`, never the driver command directly.
- [ ] `react-markdown` is added to `package.json` and the project builds.
- [ ] `Commander.test.tsx` (RTL + Vitest) with a **mock engine** covers: submit→ask→render reply,
      sessionId carried into the next call, markdown rendering, and close firing `onClose`.

## Team Execution Manifest

context:
  required:
    - path: src/lib/commander/types.ts
      reason: CommanderEngine interface + CommanderMessage — the only Commander import allowed here
    - path: src/components/Workspace/Workspace.tsx
      reason: existing feature-component structure (folder + index.ts + css + test) to mirror
    - path: src/components/Terminal/Terminal.css
      reason: existing component CSS conventions for the overlay styling
    - path: package.json
      reason: add react-markdown to dependencies
  patterns:
    - path: src/components/Workspace/ActionBar.tsx
      reason: presentational component with props/callbacks pattern
    - path: src/components/Terminal/Terminal.test.tsx
      reason: RTL + Vitest component test pattern (mock collaborators, assert behavior)
  tests:
    - path: src/components/Terminal/Terminal.test.tsx
      reason: pattern for Commander.test.tsx (mock the engine prop)
ownership:
  editable:
    - src/components/Commander/
    - package.json

## Technical Notes

Coding against the `CommanderEngine` interface (not the driver command) keeps the UI testable with
a mock and isolated from the spawn mechanics. The real engine instance (wrapping `commanderSend`)
is injected by `commander-app-wiring`.

## Dependencies

- commander-claude-driver
