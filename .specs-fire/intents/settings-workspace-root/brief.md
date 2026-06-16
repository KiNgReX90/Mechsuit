---
id: settings-workspace-root
title: Settings Panel — Configurable Workspace Root
status: pending
created: 2026-06-16T14:10:43Z
---

# Intent: Settings Panel — Configurable Workspace Root

## Goal

Add a **settings surface** (a gear icon opening a settings panel) and make the
**workspace/discovery root directory configurable and persisted**. The very
first configurable setting is the root under which directory discovery walks
(today implicitly `~/dev`). Other developers must be able to point the app at
their own projects location.

## Users

Developers other than the original author who install/run the app and keep their
projects somewhere other than `/home/ruben/dev`.

## Problem

The discovery root is **hardcoded to a literal home path** —
`const DEFAULT_DISCOVER_ROOT = "/home/ruben/dev"` in
`src-tauri/src/directory/mod.rs`. On any other machine the add-directory
discovery walk targets a non-existent path and returns nothing, and there is no
in-app way to change it. This blocks distribution to the rest of the company.

## Success Criteria

- A **gear/settings control** is reachable from the main UI and opens a settings
  panel; closing it returns to normal use.
- The panel lets the user **view and change the workspace root directory**, and
  the value is **persisted** across app restarts (same JSON-store pattern as the
  managed directory list).
- The default root is **derived from the user's home at runtime** (`$HOME/dev`),
  never a hardcoded `/home/ruben/...` path.
- `discover_directories()` uses the **configured root** when the caller passes
  none (the Sidebar calls it with no argument), so the add-directory dropdown
  reflects the configured location.
- All existing tests stay green; new behavior is covered by tests
  (backend persistence + default-from-HOME; frontend panel/store).

## Constraints

- Mirror the existing persistence approach in
  `src-tauri/src/directory/persist.rs` (a small JSON file in the app data dir).
  `Cargo.toml` is single-owner — avoid adding crates if the standard library
  (e.g. `std::env::var("HOME")`/`dirs` already in tree) suffices.
- Frontend follows `ui-test-driven-development` (TestBed/jsdom-level assertions
  on roles/labels/values, not pixels).
- Do not regress the already-shipped window/commander/auto-spawn changes.

## Notes

Suggested work items: `settings-backend` (persist + default-from-HOME + wire
discover), `settings-store-ipc` (types + invoke wrappers + store),
`settings-panel-ui` (gear control + panel component). A natural follow-on (out of
scope here) is moving other hardcoded preferences into the same panel.
