---
id: whisper-stt-backend
title: Whisper STT backend — mic capture + whisper.cpp + transcribe command
intent: commander-voice-input
kind: backend
complexity: high
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T14:10:43Z
---

# Work Item: Whisper STT backend — mic capture + whisper.cpp + transcribe command

## Description

Add offline speech-to-text in the Rust backend.

- New `src-tauri/src/stt/` module: capture microphone audio (e.g. `cpal`) into
  16kHz mono PCM, then transcribe with **whisper.cpp** (e.g. `whisper-rs`).
- Resolve a small model (e.g. `ggml-base.en`) — bundled as a resource or
  downloaded/cached on first use; document the choice in technical notes.
- Tauri commands: `start_recording` / `stop_recording_and_transcribe`
  (returning the transcript), OR a single `transcribe` that records for a bounded
  push-to-talk window. Register in `lib.rs`. Add deps to `Cargo.toml`.
- Graceful failure: no mic / no model → a clear error string, never a panic.

## Acceptance Criteria

- [ ] A unit/integration test transcribes a short bundled WAV fixture to the
      expected text (tolerant match), exercising the whisper path without a live
      mic. If model isn't present in CI, the test is gated/skipped with a clear
      message rather than failing.
- [ ] Missing mic/model yields `Err(String)`, not a panic.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes (or skips gated
      model test cleanly).
- [ ] Commands registered and callable.

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/pty/mod.rs
      reason: module + #[tauri::command] + registry/State conventions to mirror
    - path: src-tauri/src/lib.rs
      reason: register the stt module + commands in the invoke_handler
    - path: src-tauri/Cargo.toml
      reason: add cpal + whisper-rs (or equivalent) dependencies (single-owner here)
    - path: src-tauri/src/models.rs
      reason: shared serde models if a transcript/result struct is returned
  patterns:
    - path: src-tauri/src/pty/registry.rs
      reason: managing native/long-lived resources behind State + Mutex
    - path: src-tauri/src/commander/mod.rs
      reason: spawning/owning an external capability + parsing its result + error mapping
  tests:
    - path: src-tauri/src/pty/mod.rs
      reason: #[cfg(test)] integration-test pattern (drive real subsystem, assert output)
ownership:
  editable:
    - src-tauri/src/stt/
    - src-tauri/src/lib.rs
    - src-tauri/Cargo.toml
    - src-tauri/src/models.rs

## Technical Notes

High-complexity (audio capture + FFI + model handling). Consider a design doc at
decompose time. Keep the transcription core parameterizable by an input PCM/WAV
buffer so it is testable from a fixture without a live microphone. Model size vs.
quality: `base.en` is a good default for short dictation.

## Dependencies

(none)
