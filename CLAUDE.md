# CLAUDE.md

Guidance for Claude Code working in this repository.

## What it is

**mechsuit** is a Tauri desktop app — a single-screen control surface for managing
many concurrent agent/terminal sessions across directories. A left sidebar lists
user-added directories (with their git branch); clicking one opens a workspace that tiles
that directory's live PTY sessions, each typically running an interactive agent CLI
(e.g. Claude Code), with expand/focus and per-directory session tracking.

## Stack

- **Backend:** Rust — Tauri v2; real PTYs via `portable-pty`.
- **Frontend:** React + TypeScript (Vite); terminals rendered with `xterm.js`.
- **Bridge:** Tauri commands + events between the React frontend and the Rust backend.

## Status

Greenfield, early implementation. Local-only project for now; it will be exposed later.
Work is spec-driven under the INFERNO flow; intents and work items live in
`.specs-inferno/`. Currently building the **foundation** intent (project scaffold + sidebar +
multi-terminal grid); status-border styling and sidebar status dots are planned follow-on
intents.

Once the scaffold lands, build/test runs via `npm run build`, `npm test`, and
`cargo test --manifest-path src-tauri/Cargo.toml` — re-run `/init` then to capture
concrete commands and architecture.
