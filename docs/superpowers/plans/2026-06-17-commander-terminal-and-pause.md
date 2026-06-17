# Commander-as-Terminal + Workspace Pause/Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Commander from a chat overlay into an embedded interactive `claude` terminal (so space-bar voice and every interactive feature work), reachable from a top-right action-bar icon and closed on boot, and give Commander the power to suspend/resume all sessions in one or more workspaces.

**Architecture:** Generalize the PTY spawn path to launch any program directly; Commander spawns `claude` rooted at `~` with the existing MCP/persona flags (refactored to interactive), tracked once and kept alive while the drawer folds. Pause uses the PTY's foreground process group (`MasterPty::process_group_leader`) + `libc::killpg(SIGSTOP/SIGCONT)`. New MCP tools resolve "one or multiple workspaces" to their workspace sessions and toggle their paused state.

**Tech Stack:** Rust (Tauri v2, portable-pty 0.9, libc, rmcp), React + TypeScript (Vite, zustand, xterm.js), Vitest + Testing Library.

## Global Constraints

- **Platform:** Linux-only. The pause syscalls are `#[cfg(unix)]`.
- **Never launch the GUI on the active display, and never restart the running mechsuit** — restarting kills its live PTY sessions. Verify with `npm run build`, `npm test`, and `cargo test`; the **user relaunches** the app. If visual verification is unavoidable, use an off-screen Xvfb instance.
- **IPC sync:** Rust models use `#[serde(rename_all = "camelCase")]`; the TS mirror in `src/types/index.ts` must match field-for-field.
- **Commander auth:** subscription OAuth only — `env_remove("ANTHROPIC_API_KEY")` on the child, never pass `--bare`, mechsuit holds no API key.
- **Commit hygiene:** stage only the files each task names (the working tree has unrelated in-progress changes). Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- TDD, DRY, YAGNI, frequent commits. We are on branch `feat/commander-terminal-pause`.

---

## File structure

**Phase 1 — Commander as a terminal**
- `src-tauri/src/models.rs` — add `SessionKind` enum + `kind` on `SessionInfo`.
- `src-tauri/src/pty/registry.rs` — `kind` + `paused` on `SessionHandle`.
- `src-tauri/src/pty/mod.rs` — generalize `spawn_pty`; add `spawn_app_session`; keep `spawn_session` behavior. (Pause primitive added in Phase 2.)
- `src-tauri/src/commander/mod.rs` — replace headless `commander_send` with `commander_args` + `spawn_commander_session` + `CommanderSession` state.
- `src-tauri/src/lib.rs` — register new command + managed state; drop `commander_send`.
- `src/types/index.ts` — `SessionKind` + optional `kind`.
- `src/ipc/commands.ts` — add `spawnCommanderSession`; drop `commanderSend`.
- `src/lib/commander/types.ts` — **deleted**.
- `src/state/sessionsStore.ts` — filter out commander-kind sessions.
- `src/components/Commander/Commander.tsx` + `.css` + `.test.tsx` — terminal drawer.
- `src/App.tsx` + `App.test.tsx` — lazy spawn, exit→relaunch, default closed.
- `src/state/uiStore.ts` — `commanderOpen` default `false`.
- `src/components/Workspace/ActionBar.tsx` + `.test.tsx` + `Workspace.css` — Commander toggle button.

**Phase 2 — Pause/resume**
- `src-tauri/src/events.rs` — `SESSION_PAUSED` + `PausedEvent`.
- `src-tauri/src/pty/mod.rs` — `set_paused_in` + `set_session_paused` command.
- `src-tauri/src/mcp/mod.rs` — `pause_sessions`/`resume_sessions` tools + `CommanderEvents::session_paused`; persona update lives in `commander/mod.rs`.
- `src/ipc/events.ts` — `onSessionPaused`.
- `src/ipc/commands.ts` — `setSessionPaused`.
- `src/state/pausedStore.ts` (new) — paused session-id set.
- `src/App.tsx` — subscribe to `session://paused`.
- `src/components/Workspace/Grid.tsx`, `Workspace.tsx`, `Workspace.css` — paused tile state + resume control.

---

# Phase 1 — Commander as an embedded terminal

### Task 1: Session kind + generalized PTY spawn (backend)

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/pty/registry.rs`
- Modify: `src-tauri/src/pty/mod.rs`
- Modify: `src-tauri/src/mcp/mod.rs` (the test-only `SessionHandle` literal)

**Interfaces:**
- Produces:
  - `models::SessionKind` (`Workspace` | `Commander`, serde camelCase → `"workspace"`/`"commander"`).
  - `SessionInfo { id, dir_path, kind }`.
  - `SessionHandle { …, kind: SessionKind, paused: bool }`.
  - `pty::spawn_pty(program, args, cwd, env_remove, startup_command, kind, sessions, emit_output, emit_exit) -> Result<SessionInfo, String>`.
  - `pty::spawn_app_session(app, registry, program, args, cwd, env_remove, startup_command, kind) -> Result<SessionInfo, String>` (pub(crate)).

- [ ] **Step 1: Add `SessionKind` and `kind` to the models**

In `src-tauri/src/models.rs`, add the enum and field:

```rust
/// What a PTY session is: a normal workspace pane, or the singular Commander.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionKind {
    Workspace,
    Commander,
}

/// A PTY-backed session belonging to a directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub dir_path: String,
    pub kind: SessionKind,
}
```

- [ ] **Step 2: Add `kind` + `paused` to `SessionHandle`**

In `src-tauri/src/pty/registry.rs`, extend the struct (add the import at top: `use crate::models::SessionKind;`):

```rust
pub struct SessionHandle {
    pub dir_path: String,
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub killer: Box<dyn ChildKiller + Send + Sync>,
    pub output: OutputBuffer,
    /// Whether this is a workspace pane or the Commander.
    pub kind: SessionKind,
    /// Whether the session is currently OS-suspended (SIGSTOP). Phase 2.
    pub paused: bool,
}
```

- [ ] **Step 3: Update the failing test expectations in `pty/mod.rs`**

In `src-tauri/src/pty/mod.rs` tests module, add a helper just below `use super::*;` and a kind assertion. First the helper:

```rust
/// Spawn a workspace shell session with the generalized `spawn_pty`, keeping the
/// old positional ergonomics the round-trip tests rely on.
fn spawn_shell<O, E>(
    cwd: &str,
    sessions: SharedSessions,
    startup: Option<&str>,
    emit_output: O,
    emit_exit: E,
) -> Result<SessionInfo, String>
where
    O: FnMut(String, Vec<u8>) + Send + 'static,
    E: FnOnce(String, Option<i32>) + Send + 'static,
{
    spawn_pty(
        &default_shell(),
        &[],
        cwd,
        &[],
        startup,
        crate::models::SessionKind::Workspace,
        sessions,
        emit_output,
        emit_exit,
    )
}
```

Then replace every `spawn_pty(` call in the tests with `spawn_shell(` (dropping the now-internal `&default_shell(), &[], … kind` args), e.g. `spawn_pty("/", registry.share(), None, …)` → `spawn_shell("/", registry.share(), None, …)`, and the `Some("printf …")` startup case likewise. Add a kind assertion to `spawn_write_read_round_trip_and_registry_lifecycle` after the spawn:

```rust
assert_eq!(info.kind, crate::models::SessionKind::Workspace);
```

- [ ] **Step 4: Run the tests to verify they fail to compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p mechsuit pty 2>&1 | head -40`
Expected: FAIL — `spawn_pty` signature mismatch / missing `kind` field.

- [ ] **Step 5: Generalize `spawn_pty` and add `spawn_app_session`**

In `src-tauri/src/pty/mod.rs`, import the kind (`use crate::models::{SessionInfo, SessionKind};` — adjust the existing `use crate::models::SessionInfo;`) and `use tauri::{AppHandle, Emitter};` (Emitter already imported). Replace the `spawn_pty` signature + command-building head and the handle construction:

```rust
#[allow(clippy::too_many_arguments)]
fn spawn_pty<O, E>(
    program: &str,
    args: &[String],
    cwd: &str,
    env_remove: &[&str],
    startup_command: Option<&str>,
    kind: SessionKind,
    sessions: SharedSessions,
    mut emit_output: O,
    emit_exit: E,
) -> Result<SessionInfo, String>
where
    O: FnMut(String, Vec<u8>) + Send + 'static,
    E: FnOnce(String, Option<i32>) + Send + 'static,
{
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.cwd(cwd);
    for key in env_remove {
        cmd.env_remove(key);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    if let Some(line) = startup_command {
        let _ = writer.write_all(format!("{line}\n").as_bytes());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let output: OutputBuffer = OutputBuffer::default();

    let handle = SessionHandle {
        dir_path: cwd.to_string(),
        master: pair.master,
        writer,
        killer,
        output: output.clone(),
        kind,
        paused: false,
    };
    sessions.lock().unwrap().insert(id.clone(), handle);

    // (reader thread + waiter thread unchanged)
    let reader_id = id.clone();
    let reader_output = output;
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    append_output(&reader_output, &buf[..n]);
                    emit_output(reader_id.clone(), buf[..n].to_vec());
                }
            }
        }
    });
    let waiter_id = id.clone();
    let waiter_sessions = sessions.clone();
    thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code() as i32);
        waiter_sessions.lock().unwrap().remove(&waiter_id);
        emit_exit(waiter_id, code);
    });

    Ok(SessionInfo { id, dir_path: cwd.to_string(), kind })
}

/// Spawn a session and wire its output/exit to the app's event stream. Shared by
/// `spawn_session` (workspace) and `spawn_commander_session` (Commander).
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_app_session(
    app: &AppHandle,
    registry: &SessionRegistry,
    program: &str,
    args: &[String],
    cwd: &str,
    env_remove: &[&str],
    startup_command: Option<&str>,
    kind: SessionKind,
) -> Result<SessionInfo, String> {
    let sessions = registry.share();
    let output_app = app.clone();
    let exit_app = app.clone();
    spawn_pty(
        program, args, cwd, env_remove, startup_command, kind, sessions,
        move |session_id, data| {
            let _ = output_app.emit(
                SESSION_OUTPUT,
                OutputEvent { session_id, data: String::from_utf8_lossy(&data).to_string() },
            );
        },
        move |session_id, code| {
            let _ = exit_app.emit(SESSION_EXIT, ExitEvent { session_id, code });
        },
    )
}
```

Then simplify the `spawn_session` command to delegate:

```rust
#[tauri::command]
pub fn spawn_session(
    dir_path: String,
    app: tauri::AppHandle,
    registry: tauri::State<SessionRegistry>,
) -> Result<SessionInfo, String> {
    spawn_app_session(
        &app, &registry, &default_shell(), &[], &dir_path, &[],
        Some(AGENT_STARTUP_COMMAND), SessionKind::Workspace,
    )
}
```

- [ ] **Step 6: Fix the test-only `SessionHandle` literal in `mcp/mod.rs`**

In `src-tauri/src/mcp/mod.rs`, the test helper `spawn_session` builds a `SessionHandle { … }` literal. Add the two new fields:

```rust
            SessionHandle {
                dir_path: dir_path.to_string(),
                master: pair.master,
                writer,
                killer,
                output: output.clone(),
                kind: crate::models::SessionKind::Workspace,
                paused: false,
            },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p mechsuit pty mcp 2>&1 | tail -25`
Expected: PASS (pty round-trip, startup, resize/kill, buffer, filtering; mcp dispatch).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/pty/registry.rs src-tauri/src/pty/mod.rs src-tauri/src/mcp/mod.rs
git commit -m "$(printf 'feat(pty): session kind + generalized spawn_pty\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Interactive Commander spawn replaces the headless chat (backend)

**Files:**
- Modify: `src-tauri/src/commander/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `pty::spawn_app_session`, `models::SessionKind`, `mcp::McpServerAddr`.
- Produces:
  - `commander::commander_args(mcp_url: &str) -> Vec<String>` (interactive argv, no `--print`/`--output-format`/`--resume`).
  - `commander::CommanderSession(pub Mutex<Option<String>>)` managed state (`Default`).
  - `commander::spawn_commander_session` Tauri command returning `SessionInfo { kind: Commander }`, idempotent.
  - Removes `commander_send`, `run_turn`, `parse_reply`, `build_args`, `CommanderReply`.

- [ ] **Step 1: Replace the test module with interactive-arg + idempotency tests**

In `src-tauri/src/commander/mod.rs`, replace the entire `#[cfg(test)] mod tests { … }` block with:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SessionKind;
    use crate::pty::SessionRegistry;

    const URL: &str = "http://127.0.0.1:54321/mcp";

    /// Interactive Commander argv: MCP wiring + strict, pre-allowed tools, bypass
    /// permissions, persona — and crucially NO `--print` / `--output-format` /
    /// `--resume` (those forced the old headless one-shot mode).
    #[test]
    fn commander_args_are_interactive_with_mcp_and_persona() {
        let args = commander_args(URL);

        let cfg = flag_value(&args, "--mcp-config");
        assert!(
            cfg.contains(r#""mechsuit""#) && cfg.contains(r#""type":"http""#) && cfg.contains(URL),
            "mcp-config must name the mechsuit http server at the url, got: {cfg}"
        );
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        assert_flag_value(&args, "--allowedTools", "mcp__mechsuit__*");
        assert_flag_value(&args, "--permission-mode", "bypassPermissions");

        let persona = flag_value(&args, "--append-system-prompt");
        assert!(
            persona.contains("Commander") && persona.contains("read_session_output"),
            "append-system-prompt must carry the persona, got: {persona}"
        );

        assert!(!args.contains(&"--print".to_string()), "interactive: no --print");
        assert!(!args.contains(&"--output-format".to_string()), "interactive: no json");
        assert!(!args.contains(&"--resume".to_string()), "single long-lived process");
        assert!(!args.contains(&"--bare".to_string()), "OAuth, never --bare");
    }

    /// The headless `claude` is rooted at the user's home.
    #[test]
    fn spawn_cwd_is_user_home() {
        assert_eq!(SPAWN_CWD, "/home/ruben");
    }

    /// The MCP url is composed from the bound address + `MCP_PATH`.
    #[test]
    fn mcp_url_uses_path_constant() {
        use std::net::{IpAddr, Ipv4Addr, SocketAddr};
        let addr = McpServerAddr(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8123));
        assert_eq!(mcp_url(&addr), "http://127.0.0.1:8123/mcp");
    }

    /// `existing_commander_id` returns the stored id only while that session is
    /// still live in the registry, so the command re-spawns after Commander exits.
    #[test]
    fn existing_commander_id_tracks_live_registry() {
        let registry = SessionRegistry::default();
        let state = CommanderSession::default();
        assert_eq!(existing_commander_id(&registry, &state), None, "none stored yet");

        // Spawn a real (shell) session to stand in for a live Commander process.
        let info = crate::pty::spawn_app_session_for_test(
            &registry, &default_shell_for_test(), "/", SessionKind::Commander,
        );
        *state.0.lock().unwrap() = Some(info.id.clone());
        assert_eq!(existing_commander_id(&registry, &state).as_deref(), Some(info.id.as_str()));

        // Once it leaves the registry, the stale id is ignored.
        if let Some(mut h) = registry.remove(&info.id) {
            let _ = h.kill();
        }
        assert_eq!(existing_commander_id(&registry, &state), None, "stale id ignored");
    }

    // ---- helpers ----
    fn flag_value(args: &[String], flag: &str) -> String {
        let i = args.iter().position(|a| a == flag)
            .unwrap_or_else(|| panic!("flag {flag} not found in {args:?}"));
        args.get(i + 1).cloned().unwrap_or_else(|| panic!("flag {flag} has no value"))
    }
    fn assert_flag_value(args: &[String], flag: &str, expected: &str) {
        assert_eq!(flag_value(args, flag), expected, "flag {flag} value");
    }
    fn default_shell_for_test() -> String {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}
```

This test references a small test-only spawn helper. Add it to `src-tauri/src/pty/mod.rs` (outside the test module, gated to tests) so both modules can build live sessions without an app handle:

```rust
/// Spawn a registry-backed shell session with no app event wiring — test-only,
/// used by cross-module tests that need a live session of a given kind.
#[cfg(test)]
pub fn spawn_app_session_for_test(
    registry: &SessionRegistry,
    program: &str,
    cwd: &str,
    kind: crate::models::SessionKind,
) -> SessionInfo {
    spawn_pty(program, &[], cwd, &[], None, kind, registry.share(), |_, _| {}, |_, _| {})
        .expect("test spawn")
}
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p mechsuit commander 2>&1 | head -30`
Expected: FAIL — `commander_args`, `existing_commander_id`, `spawn_app_session_for_test` not defined.

- [ ] **Step 3: Rewrite `commander/mod.rs` for the interactive spawn**

In `src-tauri/src/commander/mod.rs`, keep the module doc (update the wording), `CLAUDE_BIN`, `SPAWN_CWD`, `PERSONA`, `mcp_config_json`, `mcp_url`. **Delete** `CommanderReply`, `build_args`, `parse_reply`, `run_turn`, `commander_send`. Add:

```rust
use std::sync::Mutex;

use crate::mcp::McpServerAddr;
use crate::models::{SessionInfo, SessionKind};
use crate::pty::SessionRegistry;

/// Tracks the single live Commander session id so spawning is idempotent.
#[derive(Default)]
pub struct CommanderSession(pub Mutex<Option<String>>);

/// Build the interactive `claude` argv for the Commander terminal: the same MCP
/// wiring + persona as before, but no `--print` / `--output-format` / `--resume`
/// — this is one long-lived interactive process, not a one-shot per turn.
pub fn commander_args(mcp_url: &str) -> Vec<String> {
    vec![
        "--mcp-config".to_string(),
        mcp_config_json(mcp_url),
        "--strict-mcp-config".to_string(),
        "--allowedTools".to_string(),
        "mcp__mechsuit__*".to_string(),
        "--permission-mode".to_string(),
        "bypassPermissions".to_string(),
        "--append-system-prompt".to_string(),
        PERSONA.to_string(),
    ]
}

/// The stored Commander session id, but only if it is still live in the registry
/// (so we re-spawn after Commander exits rather than returning a dead id).
fn existing_commander_id(registry: &SessionRegistry, state: &CommanderSession) -> Option<String> {
    let guard = state.0.lock().unwrap();
    let id = guard.as_ref()?;
    if registry.sessions.lock().unwrap().contains_key(id) {
        Some(id.clone())
    } else {
        None
    }
}

/// Spawn (or return the existing) Commander terminal: an interactive `claude`
/// rooted at the user's home, wired to mechsuit's MCP server, on subscription
/// OAuth (`ANTHROPIC_API_KEY` removed from the child env).
#[tauri::command]
pub fn spawn_commander_session(
    app: tauri::AppHandle,
    registry: tauri::State<SessionRegistry>,
    mcp_addr: tauri::State<McpServerAddr>,
    state: tauri::State<CommanderSession>,
) -> Result<SessionInfo, String> {
    if let Some(id) = existing_commander_id(&registry, &state) {
        return Ok(SessionInfo { id, dir_path: SPAWN_CWD.to_string(), kind: SessionKind::Commander });
    }
    let url = mcp_url(&mcp_addr);
    let args = commander_args(&url);
    let info = crate::pty::spawn_app_session(
        &app, &registry, CLAUDE_BIN, &args, SPAWN_CWD, &["ANTHROPIC_API_KEY"], None,
        SessionKind::Commander,
    )?;
    *state.0.lock().unwrap() = Some(info.id.clone());
    Ok(info)
}
```

Note: `McpServerAddr` currently has `#[allow(dead_code)]` — it is now read here, so that attribute can be removed (optional).

- [ ] **Step 4: Register the command + managed state; drop `commander_send`**

In `src-tauri/src/lib.rs`: add `.manage(commander::CommanderSession::default())` in the builder chain (next to the other `.manage`/`app.manage` calls — put it right after `.manage(registry.clone())`), and in `tauri::generate_handler![ … ]` replace `commander::commander_send,` with `commander::spawn_commander_session,`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p mechsuit commander 2>&1 | tail -20`
Expected: PASS. Then full backend build: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5` → no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commander/mod.rs src-tauri/src/lib.rs src-tauri/src/pty/mod.rs
git commit -m "$(printf 'feat(commander): interactive terminal spawn, drop headless chat\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Frontend IPC + types + store for the terminal Commander

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/ipc/commands.ts`
- Delete: `src/lib/commander/types.ts`
- Modify: `src/state/sessionsStore.ts`
- Modify: `src/state/sessionsStore.test.ts`

**Interfaces:**
- Produces: `SessionKind` type; optional `kind` on `SessionInfo`; `spawnCommanderSession(): Promise<SessionInfo>`; `sessionsStore` drops commander-kind sessions.

- [ ] **Step 1: Write the failing store test**

In `src/state/sessionsStore.test.ts`, add a test (mirroring the file's existing `listSessions` mock style) asserting commander-kind sessions are excluded from a directory's list:

```ts
it("excludes the commander session from a directory's list", async () => {
  vi.mocked(listSessions).mockResolvedValue([
    { id: "w1", dirPath: "/repo", kind: "workspace" },
    { id: "cmd", dirPath: "/repo", kind: "commander" },
  ]);
  await useSessionsStore.getState().loadDirectory("/repo");
  const list = useSessionsStore.getState().sessionsByDirectory["/repo"];
  expect(list.map((s) => s.id)).toEqual(["w1"]);
});
```

(If `listSessions` is not yet imported/mocked in that test file, add it to the existing `vi.mock("../ipc/commands", …)` block as `listSessions: vi.fn()` and `import { listSessions } from "../ipc/commands";`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/state/sessionsStore.test.ts 2>&1 | tail -20`
Expected: FAIL — commander session not filtered (list has 2 items).

- [ ] **Step 3: Add the type + filter, swap the IPC**

In `src/types/index.ts` add the kind and make it optional on `SessionInfo`:

```ts
/** Kind of PTY session: a normal workspace pane, or the singular Commander. */
export type SessionKind = "workspace" | "commander";

/** A running PTY session, tracked per-directory. */
export interface SessionInfo {
  id: string;
  dirPath: string;
  /** Backend always sets this; optional only so older test fixtures still type. */
  kind?: SessionKind;
}
```

In `src/state/sessionsStore.ts`, update `loadDirectory`'s filter:

```ts
const forDir = all.filter((s) => s.dirPath === dirPath && s.kind !== "commander");
```

In `src/ipc/commands.ts`: remove the `commanderSend` function and the `import type { CommanderMessage }` line; add:

```ts
import type { ..., SessionInfo, ... } from "../types"; // SessionInfo already imported

/**
 * Spawn (or return the existing) Commander terminal session — an interactive
 * `claude` rooted at the user's home, wired to mechsuit's MCP tools. Idempotent:
 * repeated calls return the same live session.
 */
export function spawnCommanderSession(): Promise<SessionInfo> {
  return invoke<SessionInfo>("spawn_commander_session");
}
```

Delete the file `src/lib/commander/types.ts` (and the `src/lib/commander/` directory if now empty).

```bash
rm src/lib/commander/types.ts && rmdir src/lib/commander 2>/dev/null || true
```

- [ ] **Step 4: Run the store test + typecheck**

Run: `npx vitest run src/state/sessionsStore.test.ts 2>&1 | tail -15`
Expected: PASS.
(Full `npm run build` will fail until Tasks 4–5 stop importing the deleted chat types — that's expected; it goes green at Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/ipc/commands.ts src/state/sessionsStore.ts src/state/sessionsStore.test.ts
git add -A src/lib/commander 2>/dev/null || true
git commit -m "$(printf 'feat(ipc): spawnCommanderSession, session kind, filter commander\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Commander drawer becomes a terminal

**Files:**
- Modify: `src/components/Commander/Commander.tsx`
- Modify: `src/components/Commander/Commander.css`
- Modify: `src/components/Commander/Commander.test.tsx`

**Interfaces:**
- Consumes: `Terminal` component.
- Produces: `Commander` with props `{ open: boolean; sessionId: string | null; onClose: () => void; onRelaunch: () => void }`. Renders `null` only when closed AND no session; otherwise renders the drawer (mounted while folded, `aria-hidden` when closed).

- [ ] **Step 1: Rewrite the test file**

Replace the whole body of `src/components/Commander/Commander.test.tsx` with terminal-drawer tests. The real `Terminal` mounts xterm; stub it:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Commander } from "./Commander";

// Stub the Terminal so we assert wiring (which session id is mounted) without
// xterm/canvas in jsdom.
vi.mock("../Terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="commander-terminal" data-session-id={sessionId} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("<Commander />", () => {
  it("renders nothing when closed and never opened (no session)", () => {
    const { container } = render(
      <Commander open={false} sessionId={null} onClose={() => {}} onRelaunch={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("mounts the Commander terminal for its session when open", () => {
    render(
      <Commander open sessionId="cmd-1" onClose={() => {}} onRelaunch={() => {}} />,
    );
    const term = screen.getByTestId("commander-terminal");
    expect(term).toHaveAttribute("data-session-id", "cmd-1");
  });

  it("keeps the terminal mounted (process alive) while folded", () => {
    const { rerender } = render(
      <Commander open sessionId="cmd-1" onClose={() => {}} onRelaunch={() => {}} />,
    );
    expect(screen.getByTestId("commander-terminal")).toBeInTheDocument();

    // Fold it in: the drawer hides (aria-hidden) but the terminal stays mounted.
    rerender(
      <Commander open={false} sessionId="cmd-1" onClose={() => {}} onRelaunch={() => {}} />,
    );
    expect(screen.getByTestId("commander-terminal")).toBeInTheDocument();
    // Hidden from the a11y tree so role queries treat it as closed.
    expect(screen.queryByRole("dialog", { name: "Commander" })).toBeNull();
  });

  it("offers relaunch when open with no live session", () => {
    const onRelaunch = vi.fn();
    render(
      <Commander open sessionId={null} onClose={() => {}} onRelaunch={onRelaunch} />,
    );
    expect(screen.queryByTestId("commander-terminal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Relaunch Commander" }));
    expect(onRelaunch).toHaveBeenCalledTimes(1);
  });

  it("renders the Commander emblem and fires onClose from the close control", () => {
    const onClose = vi.fn();
    render(
      <Commander open sessionId="cmd-1" onClose={onClose} onRelaunch={() => {}} />,
    );
    expect(screen.getByTestId("commander-icon")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Commander" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("folds in (onClose) when the pointer goes down outside the drawer", () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <Commander open sessionId="cmd-1" onClose={onClose} onRelaunch={() => {}} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores outside pointer-downs while closed", () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <Commander open={false} sessionId="cmd-1" onClose={onClose} onRelaunch={() => {}} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Commander/Commander.test.tsx 2>&1 | tail -20`
Expected: FAIL — `Commander` still has the chat props/markup.

- [ ] **Step 3: Rewrite `Commander.tsx`**

Replace `src/components/Commander/Commander.tsx` with the terminal drawer (keep `CommanderEmblem` from the old file verbatim at the bottom):

```tsx
import { useEffect, useRef } from "react";

import { Terminal } from "../Terminal";
import "./Commander.css";

export interface CommanderProps {
  /** Whether the drawer is folded out. */
  open: boolean;
  /** The live Commander PTY session id, or null when not yet spawned / exited. */
  sessionId: string | null;
  /** Fold the drawer in. */
  onClose: () => void;
  /** Spawn a fresh Commander process (used after it exits). */
  onRelaunch: () => void;
}

/**
 * Commander drawer: a glass panel on the right that hosts the Commander as a
 * live interactive `claude` terminal (so space-bar voice and every interactive
 * feature work). The terminal stays MOUNTED while folded — the panel is hidden
 * via a transform + `aria-hidden`, not unmounted — so the process and scrollback
 * survive folding. Open-state and the session id live in the app wiring.
 */
export function Commander({ open, sessionId, onClose, onRelaunch }: CommanderProps) {
  const drawerRef = useRef<HTMLElement>(null);

  // Fold in on a pointer-down anywhere outside the drawer (e.g. clicking a
  // terminal or the sidebar). Pointer-down — not focus loss — so a programmatic
  // focus change never collapses a drawer the user just opened.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const drawer = drawerRef.current;
      if (drawer && !drawer.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose]);

  // Put keyboard focus in the terminal whenever the drawer opens, so typing and
  // voice work immediately. xterm renders a helper <textarea> inside the pane.
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector("textarea")?.focus();
  }, [open, sessionId]);

  // Never opened and nothing to keep alive → render nothing at all.
  if (!open && sessionId == null) return null;

  return (
    <aside
      ref={drawerRef}
      className={`commander-drawer ${open ? "commander-drawer--open" : "commander-drawer--closed"}`}
      role="dialog"
      aria-label="Commander"
      aria-hidden={open ? undefined : true}
    >
      <div className="commander-header">
        <span className="commander-title">
          <CommanderEmblem />
          Commander
        </span>
        <button
          type="button"
          className="commander-close"
          aria-label="Close Commander"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="commander-body">
        {sessionId != null ? (
          <Terminal sessionId={sessionId} />
        ) : (
          <div className="commander-relaunch">
            <p>Commander exited.</p>
            <button
              type="button"
              className="commander-relaunch-button"
              onClick={onRelaunch}
            >
              Relaunch Commander
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
```

Append the existing `CommanderEmblem` function (and its `<svg data-testid="commander-icon" …>`) unchanged from the old file.

- [ ] **Step 4: Update `Commander.css`**

In `src/components/Commander/Commander.css`: keep `.commander-drawer` chrome, header, title, emblem, and close styles. Remove the chat-specific rules (`.commander-messages`, `.commander-message*`, `.commander-empty`, `.commander-pending*`, `.commander-input*`, `.commander-send*`, `.commander-error`). Replace the entry animation with open/closed slide states, widen for terminal comfort, and add the body + relaunch styles:

```css
.commander-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: clamp(380px, 30%, 560px);
  border-left: 1px solid var(--border-strong);
  background: linear-gradient(180deg, rgba(20, 26, 40, 0.98), rgba(13, 17, 28, 0.98));
  color: var(--text);
  box-shadow: -22px 0 48px -20px rgba(0, 0, 0, 0.7), inset 1px 0 0 rgba(91, 140, 255, 0.1);
  overflow: hidden;
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* Folded: slid fully off the right edge but kept mounted (process stays alive). */
.commander-drawer--closed {
  transform: translateX(100%);
  pointer-events: none;
}
.commander-drawer--open {
  transform: translateX(0);
}

/* Terminal fills the drawer below the header. */
.commander-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.commander-body .terminal-pane {
  flex: 1 1 auto;
  min-height: 0;
}

.commander-relaunch {
  margin: auto;
  text-align: center;
  color: var(--text-muted);
}
.commander-relaunch-button {
  margin-top: 0.6rem;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, var(--accent), var(--accent-strong));
  color: #fff;
}
```

- [ ] **Step 5: Run the Commander tests to verify they pass**

Run: `npx vitest run src/components/Commander/Commander.test.tsx 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Commander/Commander.tsx src/components/Commander/Commander.css src/components/Commander/Commander.test.tsx
git commit -m "$(printf 'feat(commander): render the drawer as a live terminal\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: App wiring — lazy spawn, exit→relaunch, closed on boot

**Files:**
- Modify: `src/state/uiStore.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `spawnCommanderSession`, `onSessionExit`, `Commander` (Task 4 props).
- Produces: App owns `commanderSessionId` state, spawns lazily on open, clears it on the matching `session://exit`, and passes `{ open, sessionId, onClose, onRelaunch }` to `<Commander>`.

- [ ] **Step 1: Flip the boot default**

In `src/state/uiStore.ts`, change the initial value and the doc comment:

```ts
  /** Whether the Commander drawer is open. Closed by default on startup. */
  commanderOpen: boolean;
```
```ts
  commanderOpen: false,
```

- [ ] **Step 2: Write the failing App tests**

In `src/App.test.tsx`:
1. In the `vi.mock("./ipc/commands", …)` block, **remove** the `commanderSend` line and **add**:
   `spawnCommanderSession: vi.fn().mockResolvedValue({ id: "cmd-1", dirPath: "/home/ruben", kind: "commander" }),`
2. In the `vi.mock("./ipc/events", …)` block, change `onSessionExit` so the test can fire it:

```ts
  onSessionExit: vi.fn((cb: (p: { sessionId: string; code: number }) => void) => {
    exitHandler = cb;
    return Promise.resolve(() => {});
  }),
```
   and declare `let exitHandler: ((p: { sessionId: string; code: number }) => void) | undefined;` near `navigateHandler`, resetting it to `undefined` in `beforeEach`.
3. Add `import { spawnCommanderSession } from "./ipc/commands";` and these tests:

```ts
it("spawns the Commander terminal lazily on first open (not on boot)", async () => {
  render(<App />);
  expect(spawnCommanderSession).not.toHaveBeenCalled();

  fireEvent.keyDown(window, { key: "C", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(spawnCommanderSession).toHaveBeenCalledTimes(1));

  const term = await screen.findByTestId("commander-terminal");
  expect(term).toHaveAttribute("data-session-id", "cmd-1");
});

it("shows the relaunch affordance after the Commander session exits", async () => {
  useUiStore.setState({ commanderOpen: true });
  render(<App />);
  await screen.findByTestId("commander-terminal");

  act(() => exitHandler?.({ sessionId: "cmd-1", code: 0 }));

  expect(
    await screen.findByRole("button", { name: "Relaunch Commander" }),
  ).toBeInTheDocument();
});
```
   **Important:** `App.test.tsx` mocks `./components/Terminal` with a stub whose `data-testid` is `terminal-stub` (not `commander-terminal`). So in BOTH new tests above, replace `screen.findByTestId("commander-terminal")` with `screen.findByTestId("terminal-stub")` and assert its `data-session-id` is `"cmd-1"`. The relaunch test still queries the button by role.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/App.test.tsx 2>&1 | tail -25`
Expected: FAIL — `spawnCommanderSession` never called / no relaunch button.

- [ ] **Step 4: Wire `App.tsx`**

In `src/App.tsx`:
- Replace the `commanderSend`/`engine` import + `useMemo` with the new imports and state. Remove `import { commanderSend } from "./ipc/commands";` and `import type { CommanderEngine } from "./lib/commander/types";`; add `import { spawnCommanderSession } from "./ipc/commands";` and `import { onSessionExit } from "./ipc/events";` (extend the existing events import) and `import { useCallback, useEffect, useRef, useState } from "react";`.
- Add state + spawn logic inside `App()`:

```tsx
const [commanderSessionId, setCommanderSessionId] = useState<string | null>(null);
// Mirror the id into a ref so the exit subscription (registered once) can read
// the current id without re-subscribing on every change.
const commanderSessionIdRef = useRef<string | null>(null);
commanderSessionIdRef.current = commanderSessionId;
// True after Commander exits, so the open-effect does not auto-respawn behind
// the relaunch button; cleared when the user (or first open) spawns.
const commanderExitedRef = useRef(false);

const openCommander = useCallback(async () => {
  commanderExitedRef.current = false;
  try {
    const info = await spawnCommanderSession();
    setCommanderSessionId(info.id);
  } catch {
    // Spawn failed (e.g. claude not on PATH): leave the drawer on its relaunch
    // state so the user can retry; never crash the shell.
    setCommanderSessionId(null);
    commanderExitedRef.current = true;
  }
}, []);

// Lazy spawn: the first time the drawer opens with no live session, spawn one.
useEffect(() => {
  if (commanderOpen && commanderSessionId == null && !commanderExitedRef.current) {
    void openCommander();
  }
}, [commanderOpen, commanderSessionId, openCommander]);

// Clear the id when the Commander process exits, so the drawer shows relaunch.
useEffect(() => {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void onSessionExit(({ sessionId }) => {
    if (sessionId === commanderSessionIdRef.current) {
      setCommanderSessionId(null);
      commanderExitedRef.current = true;
    }
  }).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}, []);
```
- Replace the `<Commander … />` element:

```tsx
<Commander
  open={commanderOpen}
  sessionId={commanderSessionId}
  onClose={() => setCommanderOpen(false)}
  onRelaunch={() => {
    setCommanderOpen(true);
    void openCommander();
  }}
/>
```

Note: the StatusEngine already subscribes to `onSessionExit` once; this is a **second** independent subscription scoped to the Commander id. The App-shell test `mounts the status engine once (subscribes to output and exit)` asserts `onSessionExit` is called exactly once — update that assertion to `toHaveBeenCalledTimes(2)` (StatusEngine + Commander-exit), with a clarifying comment.

- [ ] **Step 5: Run the App tests + full frontend build**

Run: `npx vitest run src/App.test.tsx 2>&1 | tail -25` → PASS.
Run: `npm run build 2>&1 | tail -15` → typechecks and builds (chat-type imports are gone now).

- [ ] **Step 6: Commit**

```bash
git add src/state/uiStore.ts src/App.tsx src/App.test.tsx
git commit -m "$(printf 'feat(app): lazy-spawn Commander terminal, closed on boot, relaunch on exit\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: Commander launcher in the action bar

**Files:**
- Modify: `src/components/Workspace/ActionBar.tsx`
- Modify: `src/components/Workspace/ActionBar.test.tsx`
- Modify: `src/components/Workspace/Workspace.css`

**Interfaces:**
- Consumes: `uiStore` (`commanderOpen`, `toggleCommander`).
- Produces: a far-right Commander toggle button (`aria-label "Commander"`, `aria-pressed` reflecting open) after a spacer.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Workspace/ActionBar.test.tsx` (add imports at top: `import { useUiStore } from "../../state/uiStore";`):

```ts
it("toggles Commander from the far-right button and reflects open state", () => {
  useUiStore.setState({ commanderOpen: false });
  render(<ActionBar hasDirectory sessionCount={1} onSpawnTerminals={vi.fn()} />);

  const button = screen.getByRole("button", { name: "Commander" });
  expect(button).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(button);
  expect(useUiStore.getState().commanderOpen).toBe(true);
});

it("shows the Commander button even without a directory", () => {
  render(<ActionBar hasDirectory={false} sessionCount={0} onSpawnTerminals={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Commander" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Workspace/ActionBar.test.tsx 2>&1 | tail -15`
Expected: FAIL — no "Commander" button.

- [ ] **Step 3: Add the button to `ActionBar.tsx`**

In `src/components/Workspace/ActionBar.tsx`, import the store and the emblem path. Add at top: `import { useUiStore } from "../../state/uiStore";`. Inside `ActionBar`, read the store:

```tsx
const commanderOpen = useUiStore((s) => s.commanderOpen);
const toggleCommander = useUiStore((s) => s.toggleCommander);
```

After the `{targets.map(…)}` block and before the closing `</div>`, add the spacer + button:

```tsx
      <span className="workspace-action-spacer" aria-hidden="true" />

      <button
        type="button"
        className={
          commanderOpen
            ? "workspace-action workspace-action--commander workspace-action--commander-active"
            : "workspace-action workspace-action--commander"
        }
        aria-label="Commander"
        aria-pressed={commanderOpen}
        title="Commander (Ctrl+Shift+C)"
        onClick={toggleCommander}
      >
        {/* Commander hex sigil with a downward double-chevron (matches the
            drawer emblem). */}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <path
            d="M12 2.2 20.3 7v10L12 21.8 3.7 17V7L12 2.2Z"
            fill="rgba(91,140,255,0.16)"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path
            d="m8.4 9.3 3.6 3.1 3.6-3.1M8.4 13.2l3.6 3.1 3.6-3.1"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
```

- [ ] **Step 4: Add the styles**

In `src/components/Workspace/Workspace.css`, add after the `.workspace-action--quick` rules:

```css
/* Push the Commander launcher to the far right, away from the pane controls. */
.workspace-action-spacer {
  flex: 0 0 0.75rem;
}

/* Commander launcher reads as the accent control; active when the drawer is open. */
.workspace-action--commander {
  color: var(--accent-hover);
  border-color: var(--border-strong);
}
.workspace-action--commander-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-hover);
}
```

Also update the empty-canvas hint copy to mention the icon:

```css
.workspace-empty-hint::after {
  content: "Press  Ctrl + Shift + C  (or the Commander icon) to summon Commander";
  /* …keep the rest of the existing rule… */
}
```

- [ ] **Step 5: Run the ActionBar tests + build**

Run: `npx vitest run src/components/Workspace/ActionBar.test.tsx 2>&1 | tail -15` → PASS.
Run: `npm test 2>&1 | tail -15` → whole frontend suite green. Run `npm run build 2>&1 | tail -5` → green.

- [ ] **Step 6: Commit**

```bash
git add src/components/Workspace/ActionBar.tsx src/components/Workspace/ActionBar.test.tsx src/components/Workspace/Workspace.css
git commit -m "$(printf 'feat(workspace): Commander launcher button in the action bar\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

# Phase 2 — Pause / resume workspace sessions

### Task 7: Backend pause primitive + command + event

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `libc`)
- Modify: `src-tauri/src/events.rs`
- Modify: `src-tauri/src/pty/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `events::SESSION_PAUSED` (`"session://paused"`) + `events::PausedEvent { session_id, paused }`.
  - `pty::set_paused_in(sessions: &SharedSessions, session_id: &str, paused: bool) -> Result<(), String>` — signals the foreground process group; refuses the Commander; idempotent.
  - `pty::set_session_paused` Tauri command (emits `SESSION_PAUSED`).

- [ ] **Step 1: Add the `libc` dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
# Pause/resume sends SIGSTOP/SIGCONT to a session's foreground process group
# (Linux-only; the app is Linux-only).
libc = "0.2"
```

- [ ] **Step 2: Add the event + payload**

In `src-tauri/src/events.rs`, add the constant and struct:

```rust
/// Emitted when a session is OS-suspended or resumed by Commander (or the UI
/// resume control). Carries the session id and its new paused state.
pub const SESSION_PAUSED: &str = "session://paused";

/// Payload for [`SESSION_PAUSED`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedEvent {
    pub session_id: String,
    pub paused: bool,
}
```

- [ ] **Step 3: Write the failing pause test**

In `src-tauri/src/pty/mod.rs` tests module, add (uses `/proc` to observe the OS state — Linux):

```rust
/// Read the process state char (field 3 of /proc/<pid>/stat): 'T' = stopped.
fn proc_state(pid: i32) -> Option<char> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // Skip past "pid (comm)" — comm may contain spaces/parens — then take the
    // first token of the rest, which is the state char.
    let after = stat.rsplit_once(')')?.1;
    after.split_whitespace().next()?.chars().next()
}

/// Pausing a session SIGSTOPs its foreground process group; resuming SIGCONTs
/// it. We run a foreground `sleep` in the pane and observe its /proc state flip.
#[test]
fn pause_then_resume_stops_and_continues_foreground_group() {
    let registry = SessionRegistry::default();
    let info = spawn_shell("/", registry.share(), Some("exec sleep 30"), |_, _| {}, |_, _| {})
        .expect("spawn");

    // Wait until the pane has a foreground process group (the sleep).
    let pgid = {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let pg = {
                let map = registry.sessions.lock().unwrap();
                map.get(&info.id).and_then(|h| h.master.process_group_leader())
            };
            if let Some(p) = pg {
                if proc_state(p).is_some() { break p; }
            }
            if Instant::now() >= deadline { panic!("no foreground pgroup appeared"); }
            thread::sleep(Duration::from_millis(20));
        }
    };

    set_paused_in(&registry.share(), &info.id, true).expect("pause");
    // Poll until stopped.
    let deadline = Instant::now() + Duration::from_secs(2);
    while proc_state(pgid) != Some('T') && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(proc_state(pgid), Some('T'), "paused process must be stopped");
    assert!(registry.sessions.lock().unwrap().get(&info.id).unwrap().paused);

    set_paused_in(&registry.share(), &info.id, false).expect("resume");
    let deadline = Instant::now() + Duration::from_secs(2);
    while proc_state(pgid) == Some('T') && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    assert_ne!(proc_state(pgid), Some('T'), "resumed process must run again");
    assert!(!registry.sessions.lock().unwrap().get(&info.id).unwrap().paused);

    if let Some(mut h) = registry.remove(&info.id) { let _ = h.kill(); }
}

/// The Commander session refuses to be paused.
#[test]
fn pause_refuses_commander_session() {
    let registry = SessionRegistry::default();
    let info = spawn_pty(
        &default_shell(), &[], "/", &[], None,
        crate::models::SessionKind::Commander, registry.share(), |_, _| {}, |_, _| {},
    ).expect("spawn");
    let err = set_paused_in(&registry.share(), &info.id, true).unwrap_err();
    assert!(err.contains("Commander"), "got: {err}");
    if let Some(mut h) = registry.remove(&info.id) { let _ = h.kill(); }
}
```

- [ ] **Step 4: Run to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p mechsuit pause 2>&1 | head -30`
Expected: FAIL — `set_paused_in` not defined.

- [ ] **Step 5: Implement the primitive + command**

In `src-tauri/src/pty/mod.rs`, add (import the new event names: extend `use crate::events::{… , SESSION_PAUSED, PausedEvent};`; add `use crate::models::SessionKind;` if not already imported; add `use crate::pty::registry::SharedSessions;` is already available as `SharedSessions` from the `pub use`):

```rust
/// SIGSTOP (pause) or SIGCONT (resume) a session's foreground process group.
///
/// Suspends/continues whatever is actually running in the pane (the agent, or a
/// command it launched) in place — no restart. Refuses the Commander session and
/// is a no-op when already in the requested state. Linux/Unix only.
pub fn set_paused_in(
    sessions: &SharedSessions,
    session_id: &str,
    paused: bool,
) -> Result<(), String> {
    let mut map = sessions.lock().unwrap();
    let handle = map
        .get_mut(session_id)
        .ok_or_else(|| format!("no such session: {session_id}"))?;
    if handle.kind == SessionKind::Commander {
        return Err("cannot pause the Commander session".to_string());
    }
    if handle.paused == paused {
        return Ok(());
    }
    #[cfg(unix)]
    {
        let pgid = handle
            .master
            .process_group_leader()
            .ok_or_else(|| "session has no foreground process group".to_string())?;
        let signal = if paused { libc::SIGSTOP } else { libc::SIGCONT };
        // SAFETY: killpg is a libc call; pgid is the PTY's foreground group.
        let rc = unsafe { libc::killpg(pgid, signal) };
        if rc != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    handle.paused = paused;
    Ok(())
}

/// Pause or resume a session (emits `session://paused` on success).
#[tauri::command]
pub fn set_session_paused(
    session_id: String,
    paused: bool,
    app: tauri::AppHandle,
    registry: tauri::State<SessionRegistry>,
) -> Result<(), String> {
    set_paused_in(&registry.share(), &session_id, paused)?;
    let _ = app.emit(SESSION_PAUSED, PausedEvent { session_id, paused });
    Ok(())
}
```

- [ ] **Step 6: Register the command**

In `src-tauri/src/lib.rs` `generate_handler!`, add `pty::set_session_paused,` after `pty::list_sessions,`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p mechsuit pause 2>&1 | tail -20`
Expected: PASS (both pause tests).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/events.rs src-tauri/src/pty/mod.rs src-tauri/src/lib.rs
git commit -m "$(printf 'feat(pty): SIGSTOP/SIGCONT pause primitive + command + event\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: Commander MCP pause/resume tools

**Files:**
- Modify: `src-tauri/src/mcp/mod.rs`
- Modify: `src-tauri/src/commander/mod.rs` (persona)

**Interfaces:**
- Consumes: `match_project`, `pty::set_paused_in`, the registry.
- Produces:
  - `CommanderEvents::session_paused(&self, session_id: &str, paused: bool)`.
  - pure `pause_workspaces(registry, dirs, queries, all, paused, events) -> Vec<(String, usize)>` (per-resolved-path → count toggled).
  - MCP tools `pause_sessions` / `resume_sessions` taking `{ queries: string[], all?: bool }`.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/mcp/mod.rs` tests module, add (the `RecordingSink` records navigate + directories_changed today; extend it with a paused log):

```rust
/// pause_workspaces resolves queries to managed dirs, pauses each dir's
/// WORKSPACE sessions (never the Commander), records a paused side effect per
/// session, and returns per-path counts.
#[test]
fn pause_workspaces_resolves_and_pauses_each_dirs_sessions() {
    let registry = SessionRegistry::default();
    let sink: Arc<RecordingSink> = Arc::new(RecordingSink::default());

    // Two managed dirs; spawn one workspace session in the first.
    let managed = vec![dir("/work/alpha", "alpha", Some("main")), dir("/work/beta", "beta", None)];
    let s1 = spawn_session(&registry, "/work/alpha"); // helper spawns kind = Workspace

    let counts = pause_workspaces(
        &registry, &managed, &["alpha".to_string()], false, true, sink.as_ref(),
    );
    assert_eq!(counts, vec![("/work/alpha".to_string(), 1)]);
    assert_eq!(sink.2.lock().unwrap().as_slice(), [(s1.clone(), true)]);
    assert!(registry.sessions.lock().unwrap().get(&s1).unwrap().paused);

    if let Some(mut h) = registry.remove(&s1) { let _ = h.kill(); }
}
```

Extend `RecordingSink` to a third field `StdMutex<Vec<(String, bool)>>` and impl:

```rust
#[derive(Default)]
struct RecordingSink(StdMutex<Vec<String>>, StdMutex<usize>, StdMutex<Vec<(String, bool)>>);
impl CommanderEvents for RecordingSink {
    fn navigate(&self, dir_path: &str) { self.0.lock().unwrap().push(dir_path.to_string()); }
    fn directories_changed(&self) { *self.1.lock().unwrap() += 1; }
    fn session_paused(&self, session_id: &str, paused: bool) {
        self.2.lock().unwrap().push((session_id.to_string(), paused));
    }
}
```

(The mcp test helper `spawn_session` builds a `SessionHandle` with `kind: SessionKind::Workspace` — set in Task 1.)

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p mechsuit pause_workspaces 2>&1 | head -30`
Expected: FAIL — `pause_workspaces` / `session_paused` not defined.

- [ ] **Step 3: Extend the events trait + impl**

In `src-tauri/src/mcp/mod.rs`, add to the `CommanderEvents` trait:

```rust
    /// Signal that a session was paused/resumed so the UI can reflect it
    /// (emits [`crate::events::SESSION_PAUSED`]).
    fn session_paused(&self, session_id: &str, paused: bool);
```

and to `AppCommanderEvents` (add the import `use crate::events::{COMMANDER_DIRECTORIES_CHANGED, COMMANDER_NAVIGATE, SESSION_PAUSED, PausedEvent};`):

```rust
    fn session_paused(&self, session_id: &str, paused: bool) {
        let _ = self.app.emit(
            SESSION_PAUSED,
            PausedEvent { session_id: session_id.to_string(), paused },
        );
    }
```

- [ ] **Step 4: Add the pure logic + tool params + tools**

In `src-tauri/src/mcp/mod.rs`, add the param struct (near the other param shapes):

```rust
/// Parameters for `pause_sessions` / `resume_sessions`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PauseSessionsParams {
    /// Workspace identifiers (name, branch, or path) to (un)pause. Each is
    /// resolved like `remove_project`.
    #[serde(default)]
    pub queries: Vec<String>,
    /// Pause/resume EVERY managed workspace instead of specific ones.
    #[serde(default)]
    pub all: bool,
}
```

Add the pure logic (near `remove_project`):

```rust
/// Resolve `queries` (or every managed dir when `all`) to managed directories,
/// then pause/resume each dir's WORKSPACE sessions via the registry, signalling
/// `events.session_paused` per toggled session. Returns (path, count) per
/// resolved directory. The Commander session is never affected (the registry
/// primitive refuses it).
pub fn pause_workspaces(
    registry: &SessionRegistry,
    dirs: &[DirectoryInfo],
    queries: &[String],
    all: bool,
    paused: bool,
    events: &dyn CommanderEvents,
) -> Vec<(String, usize)> {
    let targets: Vec<DirectoryInfo> = if all {
        dirs.to_vec()
    } else {
        queries.iter().filter_map(|q| match_project(dirs, q)).collect()
    };

    let mut out = Vec::new();
    for d in targets {
        let ids: Vec<String> = {
            let sessions = registry.sessions.lock().unwrap();
            sessions
                .iter()
                .filter(|(_, h)| h.dir_path == d.path && h.kind == crate::models::SessionKind::Workspace)
                .map(|(id, _)| id.clone())
                .collect()
        };
        let mut count = 0;
        for id in &ids {
            if crate::pty::set_paused_in(&registry.share(), id, paused).is_ok() {
                events.session_paused(id, paused);
                count += 1;
            }
        }
        out.push((d.path, count));
    }
    out
}
```

Add the two tools inside the `#[tool_router] impl MechsuitServer { … }` block:

```rust
    #[tool(
        description = "Pause (OS-suspend) all running sessions in one or more \
        managed workspaces. Pass queries (names/branches/paths) and/or all=true. \
        Reversible and non-destructive: it freezes the agents in place; resume \
        them with resume_sessions. Do it directly when asked."
    )]
    fn pause_sessions(
        &self,
        Parameters(PauseSessionsParams { queries, all }): Parameters<PauseSessionsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let dirs = self.dirs.directories();
        let counts = pause_workspaces(&self.registry, &dirs, &queries, all, true, self.events.as_ref());
        json_result(&counts)
    }

    #[tool(
        description = "Resume (un-suspend) all paused sessions in one or more \
        managed workspaces. Pass queries (names/branches/paths) and/or all=true."
    )]
    fn resume_sessions(
        &self,
        Parameters(PauseSessionsParams { queries, all }): Parameters<PauseSessionsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let dirs = self.dirs.directories();
        let counts = pause_workspaces(&self.registry, &dirs, &queries, all, false, self.events.as_ref());
        json_result(&counts)
    }
```

Also update `get_info`'s instructions string to append `, pause_sessions, resume_sessions`.

- [ ] **Step 5: Update the persona**

In `src-tauri/src/commander/mod.rs`, append to the `PERSONA` string literal (before the closing quote):

```
 You can also pause and resume a workspace's running agents: pause_sessions (queries \
and/or all:true) OS-suspends them in place — reversible and non-destructive, so do it \
directly when asked; resume_sessions continues them.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p mechsuit 2>&1 | tail -25`
Expected: PASS (full backend suite, including `pause_workspaces` + the existing mcp dispatch).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/mcp/mod.rs src-tauri/src/commander/mod.rs
git commit -m "$(printf 'feat(mcp): pause_sessions/resume_sessions Commander tools\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 9: Frontend paused state — store, event, tile UI

**Files:**
- Modify: `src/ipc/events.ts`
- Modify: `src/ipc/commands.ts`
- Create: `src/state/pausedStore.ts`
- Create: `src/state/pausedStore.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Workspace/Grid.tsx`
- Modify: `src/components/Workspace/Workspace.tsx`
- Modify: `src/components/Workspace/Workspace.css`
- Modify: `src/components/Workspace/Workspace.test.tsx`

**Interfaces:**
- Produces:
  - `onSessionPaused(cb: (p: { sessionId: string; paused: boolean }) => void): Promise<UnlistenFn>`.
  - `setSessionPaused(sessionId: string, paused: boolean): Promise<void>`.
  - `usePausedStore` with `pausedIds: Set<string>` + `setPaused(id, paused)`.
  - A `workspace-tile--paused` class + a "Resume" control on paused tiles.

- [ ] **Step 1: Add the event + command wrappers**

In `src/ipc/events.ts` add (with a `PausedEvent`-shaped inline type):

```ts
/**
 * Subscribe to `session://paused`; returns an unlisten function. Fired when a
 * session is OS-suspended/resumed (by Commander or the tile resume control).
 */
export function onSessionPaused(
  cb: (payload: { sessionId: string; paused: boolean }) => void,
): Promise<UnlistenFn> {
  return listen<{ sessionId: string; paused: boolean }>(
    "session://paused",
    (event) => cb(event.payload),
  );
}
```

In `src/ipc/commands.ts` add:

```ts
/** Pause (true) or resume (false) a single session by id. */
export function setSessionPaused(sessionId: string, paused: boolean): Promise<void> {
  return invoke<void>("set_session_paused", { sessionId, paused });
}
```

- [ ] **Step 2: Write the failing store test**

Create `src/state/pausedStore.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import { usePausedStore } from "./pausedStore";

afterEach(() => usePausedStore.setState({ pausedIds: new Set() }));

describe("pausedStore", () => {
  it("adds and removes ids as sessions pause and resume", () => {
    usePausedStore.getState().setPaused("s1", true);
    expect(usePausedStore.getState().pausedIds.has("s1")).toBe(true);

    usePausedStore.getState().setPaused("s1", false);
    expect(usePausedStore.getState().pausedIds.has("s1")).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/state/pausedStore.test.ts 2>&1 | tail -15`
Expected: FAIL — module not found.

- [ ] **Step 4: Create the store**

Create `src/state/pausedStore.ts`:

```ts
/**
 * Tracks which sessions are currently OS-suspended (paused), so tiles can show a
 * paused state. Fed by the `session://paused` subscription in App.
 */
import { create } from "zustand";

export interface PausedState {
  /** Ids of sessions currently paused. */
  pausedIds: Set<string>;
  /** Mark a session paused (true) or resumed (false). */
  setPaused: (sessionId: string, paused: boolean) => void;
}

export const usePausedStore = create<PausedState>((set) => ({
  pausedIds: new Set<string>(),
  setPaused: (sessionId, paused) =>
    set((state) => {
      const next = new Set(state.pausedIds);
      if (paused) next.add(sessionId);
      else next.delete(sessionId);
      return { pausedIds: next };
    }),
}));
```

- [ ] **Step 5: Run the store test to verify it passes**

Run: `npx vitest run src/state/pausedStore.test.ts 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 6: Subscribe in App**

In `src/App.tsx`, extend the events import with `onSessionPaused` and add `import { usePausedStore } from "./state/pausedStore";`. Inside `App()`:

```tsx
const setPaused = usePausedStore((s) => s.setPaused);

useEffect(() => {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void onSessionPaused(({ sessionId, paused }) => setPaused(sessionId, paused)).then(
    (fn) => {
      if (disposed) fn();
      else unlisten = fn;
    },
  );
  return () => {
    disposed = true;
    unlisten?.();
  };
}, [setPaused]);
```

- [ ] **Step 7: Write the failing tile test**

In `src/components/Workspace/Workspace.test.tsx`: the file already auto-mocks the whole IPC module (`vi.mock("../../ipc/commands")`), so the new `setSessionPaused` becomes a `vi.fn()` automatically — no factory edit needed. Add `import { usePausedStore } from "../../state/pausedStore";` near the other store imports, reset it in `beforeEach` by adding `usePausedStore.setState({ pausedIds: new Set() });`, then add this test (it reuses the file's `seedSessions`, `session`, and `tileFor` helpers):

```ts
it("marks a paused session's tile and resumes it from the tile control", async () => {
  seedSessions([session("a"), session("b")]);

  render(<Workspace />);
  await waitFor(() =>
    expect(screen.getAllByTestId("workspace-tile")).toHaveLength(2),
  );

  act(() => usePausedStore.getState().setPaused("a", true));

  expect(tileFor("a")).toHaveClass("workspace-tile--paused");
  expect(tileFor("b")).not.toHaveClass("workspace-tile--paused");

  fireEvent.click(screen.getByRole("button", { name: "Resume session a" }));
  expect(mockedCommands.setSessionPaused).toHaveBeenCalledWith("a", false);
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `npx vitest run src/components/Workspace/Workspace.test.tsx 2>&1 | tail -20`
Expected: FAIL — no paused class / no resume button.

- [ ] **Step 9: Render the paused state in `Grid.tsx`**

In `src/components/Workspace/Grid.tsx`, import the store and the IPC: `import { usePausedStore } from "../../state/pausedStore";` and `import { setSessionPaused } from "../../ipc/commands";`. In `Grid`, read `const pausedIds = usePausedStore((s) => s.pausedIds);`. In the per-tile render, compute `const isPaused = pausedIds.has(session.id);`, add `isPaused ? "workspace-tile--paused" : null` into the `className` array, and inside the tile (after `<div className="workspace-tile-header">…</div>`) add the overlay:

```tsx
{isPaused && (
  <div className="workspace-tile-paused" data-testid="tile-paused">
    <span className="workspace-tile-paused-badge">Paused</span>
    <button
      type="button"
      className="workspace-tile-resume"
      aria-label={`Resume session ${session.id}`}
      onClick={(e) => {
        e.stopPropagation();
        void setSessionPaused(session.id, false);
      }}
    >
      Resume
    </button>
  </div>
)}
```

- [ ] **Step 10: Mirror it on the expanded view in `Workspace.tsx`**

In `src/components/Workspace/Workspace.tsx`, import the store + IPC (same two imports). Read `const pausedIds = usePausedStore((s) => s.pausedIds);`. In the `expanded` branch, compute `const expandedPaused = expanded ? pausedIds.has(expanded) : false;`, append `expandedPaused ? "workspace-tile--paused" : null` to the expanded `className` array, and add the same paused overlay block (using `expanded` as the id) inside the `workspace-expanded` div, after its header.

- [ ] **Step 11: Style the paused tile**

In `src/components/Workspace/Workspace.css`, add:

```css
/* Paused: dim the pane and overlay a badge + resume control. */
.workspace-tile--paused {
  border-color: var(--text-dim);
}
.workspace-tile--paused .terminal-pane {
  opacity: 0.45;
  filter: grayscale(0.5);
}
.workspace-tile-paused {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.workspace-tile-paused-badge {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--bg-elev-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.6rem;
}
.workspace-tile-resume {
  font: inherit;
  font-weight: 600;
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0.35rem 0.9rem;
  border: none;
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, var(--accent), var(--accent-strong));
  color: #fff;
}
```

- [ ] **Step 12: Run the tests + full suites**

Run: `npx vitest run src/components/Workspace/Workspace.test.tsx 2>&1 | tail -20` → PASS.
Run: `npm test 2>&1 | tail -15` → all frontend green.
Run: `npm run build 2>&1 | tail -5` → green.
Run: `cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10` → green.

- [ ] **Step 13: Commit**

```bash
git add src/ipc/events.ts src/ipc/commands.ts src/state/pausedStore.ts src/state/pausedStore.test.ts src/App.tsx src/components/Workspace/Grid.tsx src/components/Workspace/Workspace.tsx src/components/Workspace/Workspace.css src/components/Workspace/Workspace.test.tsx
git commit -m "$(printf 'feat(workspace): paused tile state + resume control\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification

- [ ] `npm test` — all frontend tests pass.
- [ ] `npm run build` — typecheck + bundle clean.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — all backend tests pass.
- [ ] `cargo build --manifest-path src-tauri/Cargo.toml` — backend compiles.
- [ ] **Do not launch the GUI or restart the running mechsuit.** Hand off to the user to relaunch (`tauri build`, then run the prod binary) and confirm: boot shows no Commander; the action-bar Commander icon + Ctrl+Shift+C fold the drawer out as a live `claude` terminal (space-bar voice works); the drawer survives folding; asking Commander to "pause alpha" dims that workspace's tiles and "resume" un-dims them.
- [ ] Optional cleanup: `react-markdown` is now unused — remove it from `package.json` dependencies (`npm rm react-markdown`) and rerun `npm run build`.

## Self-review notes (coverage vs. spec)

- Embedded terminal Commander → Tasks 1, 2, 4, 5. Voice works because the pane is a real `claude` TTY (Task 2 interactive argv).
- MCP powers retained → Task 2 keeps the same `--mcp-config`/persona; `commander://*` events still fire from the unchanged MCP tools.
- Top-right icon + hotkey, closed on boot → Tasks 5, 6.
- Keep auto-fold → Task 4 (pointer-down handler retained).
- Pause/resume = true SIGSTOP/SIGCONT, reversible → Tasks 7, 8; UI feedback + resume → Task 9.
- Retire chat path → Tasks 2, 3, 4 (commander_send, CommanderEngine, commanderSend, react-markdown).
