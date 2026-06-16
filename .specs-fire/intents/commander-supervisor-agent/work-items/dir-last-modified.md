---
id: dir-last-modified
title: Directory last-modified — git-aware staleness signal, sidebar display + manual remove
intent: commander-supervisor-agent
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-16T08:53:00Z
---

# Work Item: Directory last-modified — git-aware staleness signal, sidebar display + manual remove

## Description

Surface how recently each managed directory was *worked on* so the user can spot — and clean up —
stale session groups. Adds a git-aware "last modified" timestamp to the directory model and shows
it in the sidebar with a stale indicator, plus a manual per-directory remove control.

- **Model (`models.rs`):** add `last_modified: Option<i64>` (Unix epoch **seconds**, serialized
  `lastModified`) to `DirectoryInfo`. `None` when it cannot be determined.
- **Detector (`directory/persist.rs`):** add `pub fn detect_last_modified(path: &str) -> Option<i64>`
  returning the newest **working-tree file** mtime, **git-aware**: for a repo, enumerate the files
  git would track/show via `git -C <path> ls-files --cached --others --exclude-standard -z`
  (so `.gitignore`'d / heavy dirs like `node_modules`, `target` are skipped) and take the max mtime;
  for a non-repo, fall back to a **shallow** scan of the directory's direct entries' mtimes. Wire it
  into `info_for` so `list_directories` returns `last_modified` (re-evaluated per call, like git
  status — not persisted).
- **Type mirror (`types/index.ts`):** add `lastModified: number | null` to `DirectoryInfo`.
- **Sidebar display (`components/Sidebar/`):** under each directory's path/branch, render
  **"edited 3d ago"** from `lastModified` via a small `relativeTime` util, and a **stale** visual
  (muted style + dot) once older than a tunable threshold (named constant, default **7 days**).
- **Manual remove (`components/Sidebar/` + `state/directoriesStore.ts`):** a per-directory remove
  control. On click, if that directory has **active sessions** (read from `sessionsStore`), confirm
  in-UI ("`<name>` has N live sessions — remove and kill them?") and on confirm call the existing
  `killSession` for each, then the existing `removeDirectory`; with no active sessions, remove
  directly. Add a `remove(path)` action to `directoriesStore` that wraps `removeDirectory` and drops
  the entry from local state. **Reuses existing IPC** — no backend command changes.

## Acceptance Criteria

- [ ] `DirectoryInfo` carries `lastModified` (epoch seconds) end to end (Rust `i64` ↔ TS `number`,
      camelCase), `null`/`None` when undeterminable.
- [ ] `detect_last_modified` returns the newest working-tree file mtime for a repo using
      `git ls-files --cached --others --exclude-standard` (ignored/heavy dirs excluded), and a
      shallow-scan fallback for a non-repo; `list_directories` includes it.
- [ ] The sidebar shows a relative "edited Xd ago" per directory and applies a stale style once past
      the threshold constant (default 7 days).
- [ ] The manual remove control removes a directory; when it has active sessions it first confirms,
      then kills those sessions (existing `killSession`) before removing — composing existing IPC,
      no backend change.
- [ ] A Rust test (extend `directory/persist.rs` `#[cfg(test)]`, reusing the temp-dir + `init_repo`
      helpers' style) asserts `detect_last_modified` reflects the newest file and that `list`
      returns it; a non-repo path still yields a value.
- [ ] `Sidebar.test.tsx` (mocked ipc) covers: "edited ago" rendering, stale styling past threshold,
      and manual remove (confirm path with active sessions vs direct remove without).
- [ ] `relativeTime` has a unit test for its boundary formatting (just now / Xh / Xd).

## Team Execution Manifest

context:
  required:
    - path: src-tauri/src/models.rs
      reason: add the lastModified field to DirectoryInfo
    - path: src-tauri/src/directory/persist.rs
      reason: add detect_last_modified and wire it into info_for (alongside detect_git)
    - path: src/types/index.ts
      reason: mirror lastModified on the TS DirectoryInfo
    - path: src/components/Sidebar/Sidebar.tsx
      reason: render edited-ago + stale indicator and the manual remove control
    - path: src/state/directoriesStore.ts
      reason: add a remove(path) action mirroring the existing add action
    - path: src/state/sessionsStore.ts
      reason: read a directory's active sessions to drive the remove confirm (not edited)
  patterns:
    - path: src-tauri/src/directory/persist.rs
      reason: detect_git — pattern for a path→value helper and the #[cfg(test)] TempDir/init_repo harness
    - path: src/components/Sidebar/Sidebar.tsx
      reason: existing branch/path span rendering to extend; click-handler style
    - path: src/components/Workspace/SessionActions.tsx
      reason: existing per-item icon-action-button pattern to mirror for the remove control
  tests:
    - path: src-tauri/src/directory/persist.rs
      reason: extend the existing persist test module for detect_last_modified + list output
    - path: src/components/Sidebar/Sidebar.test.tsx
      reason: extend the sidebar test for edited-ago, stale styling, and manual remove
ownership:
  editable:
    - src-tauri/src/models.rs
    - src-tauri/src/directory/persist.rs
    - src/types/index.ts
    - src/components/Sidebar/
    - src/state/directoriesStore.ts
    - src/lib/relativeTime.ts

## Technical Notes

Use epoch **seconds** (`i64`) for `lastModified`, computed from `std::fs::metadata(..).modified()`
→ duration since `UNIX_EPOCH`. Keep the git-aware enumeration robust: a missing `git` or an empty
repo must degrade to the shallow-scan fallback or `None`, never an error (mirror `detect_git`'s
tolerance). The stale threshold is a single named constant for now (a config surface is a later
open item). The manual remove deliberately composes existing `killSession` + `removeDirectory`
rather than changing the backend command, so this item stays decoupled from `workspace-discovery`
(which owns the *server-side* removal path used by Commander). `models.rs` and `types/index.ts`
gain only an additive field — `workspace-discovery` defines its own `DiscoveredDir` locally, so it
does not edit these files.

## Dependencies

(none)
