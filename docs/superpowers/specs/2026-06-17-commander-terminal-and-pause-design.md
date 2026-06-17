# Commander as an embedded terminal + workspace pause/resume

**Date:** 2026-06-17
**Status:** Design — pending review

## Problem

Commander today is a **chat overlay**: a right-side glass drawer with message
bubbles, a plain HTML `<input>`, and a Send button (`Commander.tsx`). It talks to
a **headless** `claude --print --output-format json` process per turn
(`commander_send` in `src-tauri/src/commander/mod.rs`), wired to mechsuit's
in-process MCP tools and resumed across turns with `--resume <session_id>`.

Three things are wrong with this:

1. **No voice.** The chat field is an ordinary text input, so Claude Code's
   interactive features (push-to-talk voice on the space bar, etc.) are
   unavailable — there is no real `claude` TTY behind it.
2. **It opens on every boot.** `commanderOpen` defaults to `true` in `uiStore`,
   so the panel (and conceptually a Commander process) greets you each launch.
3. **It is only reachable by hotkey** (`Ctrl+Shift+C`); there is no visible
   affordance to open it.

Separately, the user wants a **new Commander power**: temporarily **pause** all
running sessions in one or more workspaces, and resume them later.

## Goals

- Commander is an **embedded interactive terminal** running `claude` directly, so
  space-bar voice and every other interactive feature work.
- Commander keeps its current powers: rooted at `~`, wired to mechsuit's MCP
  tools (discover/add/remove projects, read/steer sessions) with the terse
  persona — plus a new **pause/resume** capability.
- A **Commander icon** at the far right of the workspace action bar toggles the
  drawer; `Ctrl+Shift+C` still works. The drawer **does not open on boot**.
- Polished styling so the drawer and its launcher clearly read as "Commander."
- "Pause a workspace" genuinely **suspends** each session's running process
  (OS-level `SIGSTOP`) and resumes it (`SIGCONT`) exactly where it left off —
  no process restart, no conversation reload.

## Non-goals

- No general "run an arbitrary command in a terminal" surface — the embedded
  terminal is specifically the Commander `claude`.
- No persistence of paused state across an app restart (a restart kills all live
  PTY sessions anyway).
- The chat-style Commander and its multi-turn `--resume` plumbing are **retired**,
  not kept alongside.

---

## Design

The work splits into two independently shippable phases. Phase 1 fixes the three
problems above; Phase 2 adds pause/resume. They share the Commander/MCP surface
but do not depend on each other for correctness.

### Phase 1 — Commander as an embedded terminal

#### Backend: spawn an interactive Commander `claude`

The PTY layer currently hardcodes "spawn the user's shell, then type a startup
command" (`spawn_pty` in `pty/mod.rs`). Generalize it minimally so it can also
launch a program **directly** as the PTY child:

- `spawn_pty` takes a small command spec instead of always using `default_shell()`:
  - `program` + `args` (argv, no shell, no quoting),
  - `cwd`,
  - optional `startup_line` (the existing "type `claude\n` into the shell"
    behaviour — workspace panes keep using this),
  - `env_remove: &[&str]` (so the Commander child can drop `ANTHROPIC_API_KEY`),
  - `kind: SessionKind`.
- **Workspace panes** stay exactly as today: `program = default_shell()`, no args,
  `startup_line = Some("claude")`, `kind = Workspace`. The shell-fallback nicety
  is preserved for normal panes.
- **Commander** runs `claude` as the PTY child directly: `program = "claude"`,
  `args = commander_args(...)`, `cwd = "/home/ruben"`,
  `env_remove = ["ANTHROPIC_API_KEY"]`, `startup_line = None`, `kind = Commander`.
  Running `claude` directly (rather than typing a long command into a shell)
  avoids shell-escaping the persona text and the MCP-config JSON. If `claude`
  exits, the pane simply ends — the frontend shows a "relaunch" state.

`commander_args` is the existing `build_args` **refactored for interactive use**:
keep `--mcp-config <mechsuit http server>`, `--strict-mcp-config`,
`--allowedTools mcp__mechsuit__*`, `--permission-mode bypassPermissions`, and
`--append-system-prompt <persona>`; **drop** `--print` and
`--output-format json` (those forced one-shot mode); **drop** `--resume`
threading (a single long-lived process needs no resume). The MCP URL still comes
from the managed `McpServerAddr`.

New command **`spawn_commander_session`** (in `commander/mod.rs`, registered in
`lib.rs`): builds the argv, spawns the PTY via `spawn_pty`, returns a
`SessionInfo`. It is **idempotent** — a managed `CommanderSession(Mutex<Option<String>>)`
holds the live Commander session id; if one already exists in the registry it is
returned instead of spawning a second.

`SessionInfo` and `SessionHandle` gain a `kind` field (`"workspace" | "commander"`,
camelCase). `list_sessions` returns it so the frontend can tell them apart.

#### Frontend: the drawer becomes a terminal

`Commander.tsx` keeps its drawer shell (header with the emblem + "Commander"
title + close ×, the slide-in animation, keep-auto-fold-on-outside-click) but its
**body becomes `<Terminal sessionId={commanderId} />`** instead of the message
list + input form.

Lifecycle (the important part):

- **Lazy spawn.** Nothing happens on boot. The first time Commander is opened, the
  app calls `spawnCommanderSession()`, stores the returned id, and mounts the
  `<Terminal>`.
- **Persist across folds.** Once spawned, the drawer **stays mounted**; folding
  it in/out toggles a CSS class that slides it off-screen via `transform`
  (**not** `display:none`, so xterm keeps its dimensions and needs no refit
  dance, and the `claude` process + scrollback survive). This is why
  keep-auto-fold is fine: clicking a pane folds Commander away without killing it.
- **Focus on open.** Opening focuses the xterm so typing / voice work immediately.
- **Exit handling.** App subscribes to `session://exit`; if the Commander session
  exits, it clears the stored id and the drawer shows a small
  "Commander exited — relaunch" state. The next open (icon or hotkey) respawns.

`App.tsx` keeps its `commander://navigate` and `commander://directories-changed`
subscriptions unchanged — those events fire from the **MCP tools**, which the
interactive Commander still uses, so live sidebar navigation/refresh keep working.

#### Launch surface, boot behaviour, styling

- **Boot:** `uiStore.commanderOpen` default flips `true → false`.
- **Launcher:** `ActionBar` (top, right-aligned) gets a **Commander toggle button
  at the far right**, after the add-terminal + quick-spawn pane controls, with a
  small spacer/divider before it so it reads as a separate control. It uses the
  Commander emblem, has `aria-pressed` reflecting `commanderOpen`, and calls
  `toggleCommander`. ActionBar reads `commanderOpen` / `toggleCommander` from
  `uiStore` (consistent with how other components consume stores). It is always
  visible (both the empty and populated workspace states render the ActionBar).
- **Hotkey:** `Ctrl+Shift+C` is unchanged.
- **Styling:** keep the emblem + accent glow / breathe in the drawer header; give
  the action-bar button an "active" treatment while open. Modestly widen the
  drawer for terminal comfort (e.g. `clamp(380px, 30%, 560px)`). Update the
  empty-canvas hint to mention the icon as well as the hotkey.

#### Retired in Phase 1

- `commander_send` command + its argv/JSON-parsing for `--print` mode (the
  argv builder is refactored, not deleted).
- The chat UI in `Commander.tsx`, `CommanderEngine` / `CommanderMessage`
  (`lib/commander/types.ts`), and the `commanderSend` IPC wrapper.
- `react-markdown` if it has no other consumer.

### Phase 2 — Pause / resume workspace sessions

#### Mechanism

A workspace pane already has a live process running in its PTY (shell → `claude`).
To **pause** it we suspend the pane's **foreground process group** at the OS level
and to **resume** we continue it:

- Read the PTY's current foreground process group from the session's `master`
  (`tcgetpgrp` on the master fd), then `killpg(pgid, SIGSTOP)` to pause /
  `SIGCONT` to resume. This freezes whatever is actually running in the pane
  (`claude`, or a build it launched) and resumes it in place — no restart, no
  reload. Linux-only (this app already is); add a small `libc` dependency for the
  syscalls. The exact portable-pty fd accessor is confirmed at implementation
  time; the mechanism is the contract.
- `SessionHandle` gains `paused: bool`. Pausing an already-paused session (or
  resuming a running one) is a no-op.

#### Backend surface

- A primitive `set_session_paused(session_id, paused)` does the signal + flips the
  flag + emits a new `session://paused` event `{ sessionId, paused }`. It refuses
  to act on a `Commander`-kind session.
- MCP tools **`pause_sessions`** / **`resume_sessions`** (added to
  `MechsuitServer` via `#[tool]`) take `{ queries: string[] }` (each resolved to a
  managed directory via the existing `match_project`, so "one or multiple
  workspaces" is satisfied) and/or `{ all: bool }`. They map each resolved
  directory to its **workspace** session ids (never Commander), call the
  primitive per id, and return per-workspace counts. Reversible and
  non-destructive, so the persona does them directly (no confirmation gate, unlike
  `remove_project`).
- The same primitive is exposed as a Tauri command so the UI resume control can
  call it directly.
- **Persona** (`PERSONA` in `commander/mod.rs`) gains a sentence describing
  `pause_sessions` / `resume_sessions`: pausing freezes a workspace's running
  agents reversibly; do it directly; resume on request.

#### Frontend feedback

- A small `pausedStore` (a `Set<sessionId>`) is updated by a single
  `session://paused` subscription (mounted once, alongside the existing app-wide
  subscriptions).
- Paused tiles (in `Grid` and the expanded view) get a `workspace-tile--paused`
  class: dimmed content + a "paused" badge, plus a small **resume** control that
  calls the `set_session_paused(id, false)` command — so a paused pane is never
  stranded if the Commander drawer is closed.

---

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `pty::spawn_pty` (generalized) | Spawn a PTY child from a command spec; reader/waiter threads; registry insert | portable-pty, registry |
| `commander::spawn_commander_session` | Build interactive `claude` argv, spawn once (idempotent), root at `~` | `spawn_pty`, `McpServerAddr`, `CommanderSession` state |
| `pty::set_session_paused` + `session://paused` | Suspend/continue a session's foreground pgroup; flip flag; emit | registry, libc |
| `mcp` `pause_sessions`/`resume_sessions` | Resolve workspaces → session ids → primitive | `match_project`, registry primitive |
| `Commander.tsx` | Drawer chrome + mounts `<Terminal>`; persist across folds; relaunch state | `Terminal`, `spawnCommanderSession`, `uiStore` |
| `ActionBar` | Pane controls + Commander toggle button | `uiStore` |
| `pausedStore` + tile class | Reflect paused state; per-tile resume | `session://paused`, `set_session_paused` |

## Testing

Test-first, per the project's TDD discipline (and the UI-TDD skill for the React
parts).

- **Rust:**
  - `commander_args` produces interactive flags: has `--mcp-config` (mechsuit
    http url), `--strict-mcp-config`, `--allowedTools mcp__mechsuit__*`,
    `--permission-mode bypassPermissions`, persona; **no** `--print`,
    `--output-format`, or `--resume`.
  - `set_session_paused` against a real PTY child: after pause the process is
    stopped (assert state `T` via `/proc/<pid>/stat`), after resume it is running
    again; idempotent; refuses a `Commander`-kind session.
  - `pause_sessions`/`resume_sessions` resolve queries → only that workspace's
    session ids, exclude Commander, return correct counts.
  - `spawn_commander_session` is idempotent (second call returns the same id).
- **Frontend (vitest + RTL):**
  - Boots with the drawer closed (`commanderOpen` default false).
  - ActionBar Commander button toggles the drawer and reflects `aria-pressed`.
  - Opening mounts a `<Terminal>` for the commander id; folding keeps it mounted.
  - Paused tile shows the badge + resume control; `pausedStore` updates on a
    `session://paused` event.
- **Build/verify:** `npm run build`, `npm test`,
  `cargo test --manifest-path src-tauri/Cargo.toml`. **Do not launch the GUI on
  the active display** and **do not restart the running mechsuit** (it would kill
  live PTY sessions) — build only and let the user relaunch; if visual
  verification is needed, use an off-screen Xvfb instance.

## Risks / open notes

- **portable-pty fd access** for `tcgetpgrp`: confirm the accessor on the 0.9
  `MasterPty` at implementation time; if unavailable, fall back to capturing the
  child pid at spawn and signalling its process group. Mechanism (suspend the
  foreground pgroup, resume with `SIGCONT`) is fixed regardless.
- **`~` as a managed directory:** the Commander session is rooted at `~`. The
  frontend filters `kind === "commander"` out of workspace grids
  (`sessionsStore`), and pause/remove operate only on `kind === "workspace"`, so
  Commander is never shown as a pane nor paused/killed by workspace actions.
- **bypassPermissions interactive:** matches today's headless behaviour; the user
  now sees everything live and can interrupt, so it is no more permissive than
  before.
