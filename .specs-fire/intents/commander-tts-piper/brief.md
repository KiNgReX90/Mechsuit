---
id: commander-tts-piper
title: Commander TTS — Spoken Replies via Piper
status: pending
created: 2026-06-16T14:10:43Z
---

# Intent: Commander TTS — Spoken Replies via Piper

## Goal

Give Commander a **voice**: speak its assistant replies aloud using **Piper**
(offline neural TTS), with a per-conversation **mute/enable toggle** so the user
controls when it talks.

## Users

The developer who wants Commander to read its (terse) replies back instead of
only reading them on screen — hands-free supervision.

## Problem

Commander is text-only. The user wants spoken replies, but only if the voice is
**genuinely good** (not robotic) and the tool is **permanently free** (no trial,
no recurring cost). Piper meets that bar; cloud TTS does not.

## Success Criteria

- When TTS is **enabled**, each new **assistant** reply is spoken aloud.
- A **mute/enable toggle** in the Commander UI controls it; the choice is honored
  for the rest of the session.
- Synthesis is **fully offline and free** via **Piper** (MIT) in the Rust
  backend; audio plays through the system output.
- Speaking never blocks the chat UI; a reply still renders immediately as text.
- Existing tests stay green; new wiring is covered (frontend toggle + speak-on-
  reply, mocking the speak IPC).

## Constraints

- TTS engine: **Piper** (MIT, offline, natural neural voice). A voice model
  (~25–60MB) is bundled or resolved on first use.
- `Cargo.toml` is single-owner — the backend work item owns dependency/asset
  additions and audio playback (e.g. `rodio`).
- Frontend follows `ui-test-driven-development`; mock the speak IPC in tests
  (no real audio in CI).

## Notes

Suggested work items: `piper-tts-backend` (resolve/bundle voice model +
synthesize + playback `speak` command), `commander-tts-wiring` (speak assistant
replies + mute toggle in the Commander UI). Pairs naturally with
`commander-voice-input` for a full voice loop, but is independent of it.
