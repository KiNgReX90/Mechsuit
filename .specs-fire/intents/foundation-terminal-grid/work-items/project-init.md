---
id: project-init
title: Project scaffold — Tauri v2 + React + TS build and test harness
intent: foundation-terminal-grid
kind: architecture
complexity: high
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T04:45:28Z
---

# Work Item: Project scaffold — Tauri v2 + React + TS build and test harness

## Description

Bootstrap the empty mechsuit repo into a runnable Tauri v2 desktop app with a
React + TypeScript + Vite frontend. This is the serial root every other work item builds
on. Establish the full dependency set (so no later item edits manifests), a two-pane app
shell layout (left sidebar region + main workspace region, both empty), and working test
harnesses on both sides (`cargo test` for Rust, Vitest + React Testing Library for the
frontend).

## Acceptance Criteria

- [ ] `npm install` succeeds and a Tauri build/check (`cargo check` in `src-tauri`, frontend `npm run build`) succeeds from a clean checkout.
- [ ] App launches showing an empty two-pane shell: a left sidebar column and a main workspace area (no functionality yet).
- [ ] `src-tauri/Cargo.toml` declares: `tauri` v2, `tauri-build`, `serde`, `serde_json`, `portable-pty`, `uuid`. Git branch detection will use `std::process::Command` (no `git2` crate).
- [ ] `package.json` declares: `react`, `react-dom`, `@tauri-apps/api`, `@xterm/xterm`, `@xterm/addon-fit`, `zustand`; dev: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- [ ] A trivial Rust `#[cfg(test)]` test passes via `cargo test`.
- [ ] A trivial frontend render smoke test passes via `npm test` (Vitest, jsdom env).
- [ ] `.gitignore` covers `node_modules`, `dist`, `target`, and Tauri build output.
- [ ] `.cargo/config.toml` caps Rust build parallelism (`[build]\njobs = 4`) so a compile does not saturate this 8-core / 31 GiB machine when it runs alongside node builders and the active session.

## Team Execution Manifest

context:
  required:
    - path: CLAUDE.md
      reason: project vision and pre-implementation status
    - path: .specs-fire/intents/foundation-terminal-grid/brief.md
      reason: intent spec, confirmed stack, and scope boundaries
  patterns:
    - path: .specs-fire/intents/foundation-terminal-grid/brief.md
      reason: constraints to honor (Tauri v2, Rust backend, React frontend, Linux primary)
  tests:
    - path: src-tauri/Cargo.toml
      reason: created here; `cargo test` runs the Rust smoke test
    - path: package.json
      reason: created here; `npm test` runs the Vitest render smoke test
ownership:
  editable:
    - package.json
    - package-lock.json
    - vite.config.ts
    - vitest.config.ts
    - tsconfig.json
    - tsconfig.node.json
    - index.html
    - .gitignore
    - .cargo/config.toml
    - src/main.tsx
    - src/App.tsx
    - src/App.test.tsx
    - src/vite-env.d.ts
    - src/test/setup.ts
    - src-tauri/Cargo.toml
    - src-tauri/tauri.conf.json
    - src-tauri/build.rs
    - src-tauri/src/main.rs
    - src-tauri/src/lib.rs

## Technical Notes

Use Tauri v2 (`@tauri-apps/api` v2, `tauri` 2.x crate, `tauri-build`). `main.rs` delegates
to `lib.rs`'s `run()`. Keep `lib.rs` minimal here — a default `tauri::Builder` with `.run()`
and NO commands yet (`rust-ipc-contract` adds the `invoke_handler`, modules, and managed
state afterward). `App.tsx` renders a flex layout: an `<aside>` sidebar pane + a `<main>`
workspace pane, minimal styling, no behavior. Configure Vitest with the jsdom environment
and a setup file importing `@testing-library/jest-dom`. Declaring the full dependency set
here is deliberate: it keeps `Cargo.toml`/`package.json` single-owner so backend and
frontend items never collide on manifests.

Machine-safety: `.cargo/config.toml` pins `[build] jobs = 4` (half the 8 logical cores) so
a Rust compile leaves headroom for concurrent node builders and the running session.
Builders all share the one intent worktree, so cargo's target-dir lock already serializes
concurrent Rust compiles within a single team run — the real over-subscription risk is
launching multiple `/specsmd-fire-team` sessions at once, which should be avoided.

## Dependencies

(none)
