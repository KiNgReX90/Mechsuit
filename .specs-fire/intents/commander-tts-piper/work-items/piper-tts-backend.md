---
id: piper-tts-backend
title: Piper TTS backend — resolve voice model + synthesize + play, speak command
intent: commander-tts-piper
kind: backend
complexity: high
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T14:10:43Z
---

# Work Item: Piper TTS backend — resolve voice model + synthesize + play, speak command

## Description

Add offline text-to-speech in the Rust backend.

- New `src-tauri/src/tts/` module: synthesize text to audio with **Piper**
  (invoke the piper binary, or a Rust binding) using a bundled/resolved voice
  model (~25–60MB); play the resulting audio (e.g. `rodio`).
- Tauri command `speak(text)` (and optionally `stop_speaking`), registered in
  `lib.rs`. Add deps/assets to `Cargo.toml`.
- Non-blocking: synthesis/playback runs off the UI thread; failures (missing
  binary/model) return `Err(String)`, never panic.

## Acceptance Criteria

- [ ] `speak("...")` synthesizes and plays without blocking; returns Ok on
      success. A test exercises the synthesis path against a bundled model, or is
      cleanly gated/skipped when the model/binary is absent in CI.
- [ ] Missing piper/model yields `Err(String)`, not a panic.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes (or skips gated
      test cleanly).
- [ ] Command registered and callable.

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/commander/mod.rs
      reason: pattern for spawning an external tool, mapping output/errors (CLAUDE_BIN style)
    - path: src-tauri/src/lib.rs
      reason: register the tts module + speak command
    - path: src-tauri/Cargo.toml
      reason: add piper binding/rodio dependencies + any bundled-asset config (single-owner)
    - path: src-tauri/tauri.conf.json
      reason: bundle resources (voice model) if shipped as an app resource
  patterns:
    - path: src-tauri/src/commander/mod.rs
      reason: external-process invocation + result/error handling to mirror
    - path: src-tauri/src/pty/mod.rs
      reason: spawning work on background threads + command conventions
  tests:
    - path: src-tauri/src/commander/mod.rs
      reason: #[cfg(test)] approach for argument/IO-shaped logic without the live tool
ownership:
  editable:
    - src-tauri/src/tts/
    - src-tauri/src/lib.rs
    - src-tauri/Cargo.toml
    - src-tauri/tauri.conf.json

## Technical Notes

High-complexity (external synth + audio playback + asset bundling). Keep text→
audio bytes separable from playback so the synth path is testable. Decide
bundled-resource vs. first-run download at decompose/design time; document model
license (Piper voices are typically permissive).

## Dependencies

(none)
