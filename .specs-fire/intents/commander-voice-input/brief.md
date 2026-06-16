---
id: commander-voice-input
title: Commander Voice Input — Push-to-Talk Speech-to-Text
status: pending
created: 2026-06-16T14:10:43Z
---

# Intent: Commander Voice Input — Push-to-Talk Speech-to-Text

## Goal

Let the user **dictate** to the **Commander chat** by push-to-talk: hold the
spacebar (while the Commander input is empty) to record from the microphone,
release to transcribe locally and insert the text into the input. This mirrors
the native voice feature of the Claude Code CLI.

## Users

The developer driving Commander hands-free / faster than typing.

## Problem

Commander is a typing-only chat. The native `claude` CLI offers hold-spacebar
voice, and the terminal panes already inherit it for free (mechsuit forwards all
keystrokes through the PTY to `claude`). The **Commander chat is mechsuit's own
React UI**, so it does NOT get that feature — it needs its own speech-to-text.

## Success Criteria

- In the Commander input, **holding spacebar while the field is empty starts
  recording**; releasing stops it, transcribes, and inserts the text.
- A clear **recording indicator** shows while capturing.
- Transcription runs **fully offline and free** via `whisper.cpp` in the Rust
  backend (no cloud, no API key, no recurring cost).
- The space key still types normally once the field is non-empty (no conflict).
- Scope is **Commander only** — terminals are intentionally untouched (they
  already get `claude`'s `/voice`).

## Constraints

- STT engine: **whisper.cpp** (MIT, offline). Microphone capture in Rust
  (e.g. `cpal`). A small model is bundled or resolved on first use.
- `Cargo.toml` is single-owner — the backend work item owns dependency additions.
- Frontend follows `ui-test-driven-development`; mock the transcribe IPC in tests
  (no real mic/model in CI).

## Notes

Suggested work items: `whisper-stt-backend` (mic capture + whisper.cpp + a
`transcribe` command), `commander-push-to-talk-ui` (hold-space-when-empty UX +
insert). The backend item is high-complexity (audio + FFI + model handling) and
may warrant a design doc at decompose time.
