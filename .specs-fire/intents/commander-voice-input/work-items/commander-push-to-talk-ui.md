---
id: commander-push-to-talk-ui
title: Commander push-to-talk UI — hold-space-when-empty record + insert transcript
intent: commander-voice-input
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [whisper-stt-backend]
created: 2026-06-16T14:10:43Z
---

# Work Item: Commander push-to-talk UI — hold-space-when-empty record + insert transcript

## Description

Add push-to-talk dictation to the Commander input.

- Add `transcribe` (and any start/stop) invoke wrappers to `src/ipc/commands.ts`.
- In `src/components/Commander/Commander.tsx`: when the input is **empty** and the
  user **presses and holds Space**, start recording (swallow the space so it does
  not type); on release, call the transcribe command and insert the returned text
  into the input. Once the input is non-empty, Space types normally.
- Show a **recording indicator** while capturing; handle transcribe errors
  gracefully (no crash, restore normal input).

## Acceptance Criteria

- [ ] Holding Space on an empty input enters recording state and does not insert a
      space; releasing calls transcribe and sets the input to the transcript
      (assert via mocked ipc + key events).
- [ ] With non-empty input, Space types a space normally (no recording).
- [ ] A recording indicator is shown while capturing and cleared after.
- [ ] Transcribe failure leaves the UI usable (no throw); covered by a test.
- [ ] `Commander.test.tsx` updated; `npm test` and `tsc --noEmit` pass.

## Team Execution Manifest

context:
  required:
    - path: src/components/Commander/Commander.tsx
      reason: the chat input where push-to-talk lives (keydown/keyup on the input)
    - path: src/components/Commander/Commander.test.tsx
      reason: existing RTL test to extend (mock the transcribe ipc)
    - path: src/ipc/commands.ts
      reason: add transcribe/start/stop invoke wrappers
  patterns:
    - path: src/components/Commander/Commander.tsx
      reason: existing controlled-input + async-call + pending-state pattern to mirror
    - path: src/components/Terminal/Terminal.tsx
      reason: keyboard-event handling reference
  tests:
    - path: src/components/Commander/Commander.test.tsx
      reason: pattern for simulating key events + mocking ipc
ownership:
  editable:
    - src/components/Commander/
    - src/ipc/commands.ts
    - src/types/index.ts

## Technical Notes

The "empty input" guard is what avoids the space-typing conflict and mirrors
`claude`'s behavior. Keep mic/model concerns entirely in the backend; this item
only orchestrates record→transcribe→insert and the indicator.

## Dependencies

- whisper-stt-backend
