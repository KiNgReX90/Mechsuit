---
id: commander-tts-wiring
title: Commander TTS wiring — speak assistant replies + mute toggle
intent: commander-tts-piper
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [piper-tts-backend]
created: 2026-06-16T14:10:43Z
---

# Work Item: Commander TTS wiring — speak assistant replies + mute toggle

## Description

Make Commander speak its replies, user-controlled.

- Add a `speak` invoke wrapper to `src/ipc/commands.ts`.
- In `src/components/Commander/Commander.tsx`: when TTS is **enabled**, call
  `speak(reply)` as each new **assistant** turn arrives (text still renders
  immediately — speaking is fire-and-forget, never blocking).
- Add a **mute/enable toggle** in the Commander header; default state is the
  user's choice (persist within the session). Honor it on every reply.

## Acceptance Criteria

- [ ] When enabled, a new assistant reply triggers `speak(replyText)` once
      (assert with mocked ipc); when muted, it does not.
- [ ] A header toggle switches enabled/muted and its state is reflected in the UI.
- [ ] Speaking never blocks rendering; a `speak` rejection does not crash the chat.
- [ ] `Commander.test.tsx` updated; `npm test` and `tsc --noEmit` pass.

## Team Execution Manifest

context:
  required:
    - path: src/components/Commander/Commander.tsx
      reason: where assistant replies arrive (handleSubmit) and the header toggle lives
    - path: src/components/Commander/Commander.test.tsx
      reason: existing RTL test to extend (mock the speak ipc)
    - path: src/ipc/commands.ts
      reason: add the speak invoke wrapper
    - path: src/components/Commander/Commander.css
      reason: styling the header mute/enable toggle
  patterns:
    - path: src/components/Commander/Commander.tsx
      reason: existing assistant-reply handling + header controls to mirror
    - path: src/components/Workspace/SessionActions.tsx
      reason: icon toggle-button pattern
  tests:
    - path: src/components/Commander/Commander.test.tsx
      reason: pattern for asserting effects on new assistant turn + mocking ipc
ownership:
  editable:
    - src/components/Commander/
    - src/ipc/commands.ts
    - src/types/index.ts

## Technical Notes

Only fire on assistant turns (not user turns). If `commander-voice-input` lands
too, both edit `src/components/Commander/` and `src/ipc/commands.ts` — run these
intents sequentially (or the team orchestrator serializes the overlap).

## Dependencies

- piper-tts-backend
