//! PTY session commands.
//!
//! Implements the session lifecycle on top of `portable-pty`: spawn a real
//! PTY rooted at a directory running the user's shell, stream its output to
//! the frontend via `session://output`, accept input via `write_session`,
//! support `resize_session`, and terminate via `kill_session`. Live sessions
//! are tracked in the shared [`SessionRegistry`] so `list_sessions` can return
//! a directory's sessions. `session://exit` is emitted on natural or forced
//! exit.

pub mod registry;

pub use registry::{
    append_output, OutputBuffer, SessionHandle, SessionRegistry, SharedSessions,
};

use std::io::{Read, Write};
use std::thread;

#[cfg(unix)]
use libc;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

use crate::events::{ExitEvent, OutputEvent, PausedEvent, SESSION_EXIT, SESSION_OUTPUT, SESSION_PAUSED};
use crate::models::{SessionInfo, SessionKind};

/// Resolve the user's shell, falling back to `/bin/bash`.
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

/// Command auto-run in every interactive agent session as soon as its shell is
/// ready: launches the Claude Code CLI. Spawned via the shell (rather than as
/// the PTY's direct child) so the command line is echoed to the user and the
/// pane falls back to a live shell prompt if `claude` exits or is not on PATH.
const AGENT_STARTUP_COMMAND: &str = "claude";

/// Spawn the PTY pair + child and wire up the reader/waiter threads.
///
/// Shared between the Tauri command and the test harness so the round-trip is
/// exercised without the Tauri runtime. `sessions` is the shared session map
/// (from [`SessionRegistry::share`]); the `emit_output` / `emit_exit` closures
/// receive the streamed bytes / exit code — in the command path they forward
/// to the `AppHandle`, in tests they push to channels.
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
    // Drop the slave after spawn so the child holds the only slave fd; this
    // lets the reader observe EOF once the child exits.
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    // Auto-run the startup command (e.g. the agent CLI) as the session's first
    // input. The PTY line discipline buffers these bytes until the shell starts
    // reading, so this is safe even though the child may not be ready yet.
    if let Some(line) = startup_command {
        let _ = writer.write_all(format!("{line}\n").as_bytes());
    }

    let id = uuid::Uuid::new_v4().to_string();

    // Bounded scrollback shared with the reader thread; a clone lives on the
    // handle so the in-process MCP server can read it via `recent_output`.
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

    // Reader thread: stream PTY output until EOF, appending each chunk to the
    // bounded scrollback buffer in addition to emitting `session://output`.
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

    // Waiter thread: wait for the child, emit exit, and drop the session.
    let waiter_id = id.clone();
    let waiter_sessions = sessions.clone();
    thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code() as i32);
        waiter_sessions.lock().unwrap().remove(&waiter_id);
        emit_exit(waiter_id, code);
    });

    Ok(SessionInfo { id, dir_path: cwd.to_string(), kind })
}

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

/// Spawn a PTY session rooted at `dir_path` running the user's shell, which
/// immediately auto-launches the agent CLI ([`AGENT_STARTUP_COMMAND`]).
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

/// Write input bytes to a session's PTY master.
#[tauri::command]
pub fn write_session(
    session_id: String,
    data: String,
    registry: tauri::State<SessionRegistry>,
) -> Result<(), String> {
    let mut sessions = registry.sessions.lock().unwrap();
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("no such session: {session_id}"))?;
    handle.write(data.as_bytes()).map_err(|e| e.to_string())
}

/// Resize a session's PTY.
#[tauri::command]
pub fn resize_session(
    session_id: String,
    cols: u16,
    rows: u16,
    registry: tauri::State<SessionRegistry>,
) -> Result<(), String> {
    let sessions = registry.sessions.lock().unwrap();
    let handle = sessions
        .get(&session_id)
        .ok_or_else(|| format!("no such session: {session_id}"))?;
    handle.resize(cols, rows)
}

/// Terminate a session's child and remove it from the registry.
///
/// `session://exit` is emitted by the session's waiter thread once the child
/// is reaped, so kill only needs to request termination + drop the handle.
#[tauri::command]
pub fn kill_session(
    session_id: String,
    registry: tauri::State<SessionRegistry>,
) -> Result<(), String> {
    let mut handle = registry
        .remove(&session_id)
        .ok_or_else(|| format!("no such session: {session_id}"))?;
    handle.kill().map_err(|e| e.to_string())
}

/// List every live session across all directories. The frontend filters by
/// directory client-side (see `sessionsStore.loadDirectory`), so this takes no
/// `dir_path` argument — matching the no-arg `listSessions()` IPC wrapper.
#[tauri::command]
pub fn list_sessions(
    registry: tauri::State<SessionRegistry>,
) -> Result<Vec<SessionInfo>, String> {
    let sessions = registry.sessions.lock().unwrap();
    Ok(sessions
        .iter()
        .map(|(id, h)| SessionInfo {
            id: id.clone(),
            dir_path: h.dir_path.clone(),
            kind: h.kind,
        })
        .collect())
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

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

    /// Spawn a PTY, write a command, and assert its echoed output streams back
    /// through the reader thread. Also verifies the session is registered on
    /// spawn (registry add) and removed after the child exits (registry remove).
    #[test]
    fn spawn_write_read_round_trip_and_registry_lifecycle() {
        let registry = SessionRegistry::default();
        let (out_tx, out_rx) = mpsc::channel::<(String, Vec<u8>)>();
        let (exit_tx, exit_rx) = mpsc::channel::<(String, Option<i32>)>();

        let info = spawn_shell(
            "/",
            registry.share(),
            None,
            move |id, data| {
                let _ = out_tx.send((id, data));
            },
            move |id, code| {
                let _ = exit_tx.send((id, code));
            },
        )
        .expect("spawn_pty should succeed");

        assert_eq!(info.kind, crate::models::SessionKind::Workspace);

        // Registry add: the session is live immediately after spawn.
        assert!(registry.contains(&info.id), "session must be registered");
        assert_eq!(registry.len(), 1);

        // Write a command that prints a marker then exits the shell.
        {
            let mut sessions = registry.sessions.lock().unwrap();
            let handle = sessions.get_mut(&info.id).expect("handle present");
            handle
                .write(b"printf MECHSUIT_OK\\n; exit 0\n")
                .expect("write to pty master");
        }

        // Read round-trip: collect output until we see the marker (or time out).
        let mut seen = String::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            match out_rx.recv_timeout(Duration::from_secs(1)) {
                Ok((_, data)) => {
                    seen.push_str(&String::from_utf8_lossy(&data));
                    if seen.contains("MECHSUIT_OK") {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        assert!(
            seen.contains("MECHSUIT_OK"),
            "expected echoed marker in PTY output, got: {seen:?}"
        );

        // Exit event fires and the waiter thread removes the session.
        let (exit_id, _code) = exit_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("exit event should fire after shell exits");
        assert_eq!(exit_id, info.id);

        // Registry remove: poll briefly since removal happens on the waiter thread.
        let deadline = Instant::now() + Duration::from_secs(5);
        while registry.contains(&info.id) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            !registry.contains(&info.id),
            "session must be removed from registry after exit"
        );
        assert!(registry.is_empty());
    }

    /// A startup command passed to `spawn_pty` is auto-run in the session as
    /// soon as the shell is ready — without anyone writing to the PTY. This
    /// backs `spawn_session` auto-launching the agent CLI on every new session.
    /// The marker is split across two `printf`s so it appears *contiguously*
    /// only in the command's OUTPUT, never in the shell's echo of the command
    /// line — proving execution, not just injection.
    #[test]
    fn startup_command_runs_on_spawn() {
        let registry = SessionRegistry::default();
        let (out_tx, out_rx) = mpsc::channel::<(String, Vec<u8>)>();

        let info = spawn_shell(
            "/",
            registry.share(),
            Some("printf MECHSUIT; printf _STARTUP; exit 0"),
            move |id, data| {
                let _ = out_tx.send((id, data));
            },
            |_, _| {},
        )
        .expect("spawn_pty should succeed");

        let mut seen = String::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            match out_rx.recv_timeout(Duration::from_secs(1)) {
                Ok((_, data)) => {
                    seen.push_str(&String::from_utf8_lossy(&data));
                    if seen.contains("MECHSUIT_STARTUP") {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        assert!(
            seen.contains("MECHSUIT_STARTUP"),
            "startup command should have run on spawn, got: {seen:?}"
        );

        if let Some(mut h) = registry.remove(&info.id) {
            let _ = h.kill();
        }
    }

    /// Resize succeeds on a live session; explicit remove/kill empties the map.
    #[test]
    fn resize_and_kill_lookup() {
        let registry = SessionRegistry::default();
        let info = spawn_shell("/", registry.share(), None, |_, _| {}, |_, _| {})
            .expect("spawn_pty should succeed");

        {
            let sessions = registry.sessions.lock().unwrap();
            let handle = sessions.get(&info.id).expect("handle present");
            handle.resize(120, 40).expect("resize should succeed");
        }

        // Unknown id: explicit registry remove returns None.
        assert!(registry.remove("does-not-exist").is_none());

        // Kill the real session and confirm it leaves the registry.
        let mut handle = registry.remove(&info.id).expect("handle present");
        let _ = handle.kill();
        assert!(registry.is_empty());
    }

    /// Drive a child that prints a known marker and assert `recent_output`
    /// returns that tail; also that the whole-buffer and last-bytes views and
    /// the unknown-id case behave as specified.
    #[test]
    fn recent_output_returns_buffered_tail() {
        let registry = SessionRegistry::default();
        let (out_tx, out_rx) = mpsc::channel::<(String, Vec<u8>)>();

        let info = spawn_shell(
            "/",
            registry.share(),
            None,
            move |id, data| {
                let _ = out_tx.send((id, data));
            },
            |_, _| {},
        )
        .expect("spawn_pty should succeed");

        {
            let mut sessions = registry.sessions.lock().unwrap();
            let handle = sessions.get_mut(&info.id).expect("handle present");
            handle
                .write(b"printf MECHSUIT_BUFFER_OK\\n; exit 0\n")
                .expect("write to pty master");
        }

        // Drain the stream until the marker arrives (or time out); the reader
        // thread appends to the buffer on the same chunks it streams.
        let mut seen = String::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            match out_rx.recv_timeout(Duration::from_secs(1)) {
                Ok((_, data)) => {
                    seen.push_str(&String::from_utf8_lossy(&data));
                    if seen.contains("MECHSUIT_BUFFER_OK") {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        assert!(
            seen.contains("MECHSUIT_BUFFER_OK"),
            "expected echoed marker in stream, got: {seen:?}"
        );

        // Whole-buffer view contains the marker.
        let whole = registry
            .recent_output(&info.id, None)
            .expect("known session must return Some");
        assert!(
            whole.contains("MECHSUIT_BUFFER_OK"),
            "recent_output(None) must contain the marker, got: {whole:?}"
        );

        // last_bytes tail is bounded by the request and is a suffix of whole.
        let tail = registry
            .recent_output(&info.id, Some(8))
            .expect("known session must return Some");
        assert!(tail.len() <= 8, "tail must not exceed requested bytes");
        assert!(
            whole.ends_with(&tail),
            "tail must be a suffix of the whole buffer"
        );

        // Unknown id yields None.
        assert!(registry.recent_output("does-not-exist", None).is_none());

        if let Some(mut h) = registry.remove(&info.id) {
            let _ = h.kill();
        }
    }

    /// The scrollback buffer stays within `OUTPUT_BUFFER_CAP` even when the
    /// child emits far more than the cap.
    #[test]
    fn output_buffer_is_capped() {
        let registry = SessionRegistry::default();
        let (out_tx, out_rx) = mpsc::channel::<(String, Vec<u8>)>();

        let info = spawn_shell(
            "/",
            registry.share(),
            None,
            move |id, data| {
                let _ = out_tx.send((id, data));
            },
            |_, _| {},
        )
        .expect("spawn_pty should succeed");

        {
            let mut sessions = registry.sessions.lock().unwrap();
            let handle = sessions.get_mut(&info.id).expect("handle present");
            // Emit well over the cap, then a marker so we know output finished.
            handle
                .write(
                    b"for i in $(seq 1 4000); do printf '0123456789abcdef0123456789abcdef\\n'; done; printf DONE_CAP\\n; exit 0\n",
                )
                .expect("write to pty master");
        }

        let mut seen = String::new();
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            match out_rx.recv_timeout(Duration::from_secs(2)) {
                Ok((_, data)) => {
                    seen.push_str(&String::from_utf8_lossy(&data));
                    if seen.contains("DONE_CAP") {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        assert!(
            seen.contains("DONE_CAP"),
            "child should have finished emitting; got {} bytes",
            seen.len()
        );

        // Buffer never exceeds the cap, despite far more output streamed.
        let buffered = registry
            .recent_output(&info.id, None)
            .expect("known session must return Some");
        assert!(
            buffered.len() <= registry::OUTPUT_BUFFER_CAP,
            "buffer must stay within cap: {} > {}",
            buffered.len(),
            registry::OUTPUT_BUFFER_CAP
        );

        if let Some(mut h) = registry.remove(&info.id) {
            let _ = h.kill();
        }
    }

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

    /// `list_sessions`-style filtering returns only the matching directory's
    /// sessions, proving the registry is shared and queryable by directory.
    #[test]
    fn sessions_are_filtered_by_directory() {
        let registry = SessionRegistry::default();
        let a = spawn_shell("/", registry.share(), None, |_, _| {}, |_, _| {}).expect("spawn a");
        let b = spawn_shell("/tmp", registry.share(), None, |_, _| {}, |_, _| {}).expect("spawn b");

        let in_tmp: Vec<String> = {
            let sessions = registry.sessions.lock().unwrap();
            sessions
                .iter()
                .filter(|(_, h)| h.dir_path == "/tmp")
                .map(|(id, _)| id.clone())
                .collect()
        };
        assert_eq!(in_tmp, vec![b.id.clone()]);
        assert!(!in_tmp.contains(&a.id));

        // Clean up both children.
        for id in [a.id, b.id] {
            if let Some(mut h) = registry.remove(&id) {
                let _ = h.kill();
            }
        }
    }
}
