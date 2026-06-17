//! Session registry.
//!
//! Holds the live PTY sessions keyed by session id. Each [`SessionHandle`]
//! owns the master PTY (used for resize), a writer for input, and a child
//! killer used to terminate the process. The whole map lives behind a
//! `Mutex` and is shared via Tauri managed state.

use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{ChildKiller, MasterPty, PtySize};

use crate::models::SessionKind;

/// Shared session map: `Arc` so background reader/waiter threads can hold a
/// clone that outlives the command invocation, while the managed
/// [`SessionRegistry`] keeps the same underlying map.
pub type SharedSessions = Arc<Mutex<HashMap<String, SessionHandle>>>;

/// Maximum bytes retained in a session's scrollback buffer. Appends past this
/// cap evict the oldest bytes (ring semantics), so the buffer never grows
/// unbounded. ~64 KiB is enough recent output for the MCP server to read.
pub const OUTPUT_BUFFER_CAP: usize = 64 * 1024;

/// Shared, bounded per-session output buffer. Wrapped in `Arc<Mutex<..>>` (like
/// [`SharedSessions`]) so the reader thread can write it while the in-process
/// MCP server reads it via [`SessionRegistry::recent_output`].
pub type OutputBuffer = Arc<Mutex<VecDeque<u8>>>;

/// Append `chunk` to a session's output buffer, evicting the oldest bytes once
/// the total would exceed [`OUTPUT_BUFFER_CAP`] (ring semantics).
pub fn append_output(buffer: &OutputBuffer, chunk: &[u8]) {
    let mut buf = buffer.lock().unwrap();
    buf.extend(chunk.iter().copied());
    while buf.len() > OUTPUT_BUFFER_CAP {
        buf.pop_front();
    }
}

/// Per-session handle held by the registry.
///
/// The master PTY is kept so the session can be resized; the writer accepts
/// input bytes; the killer terminates the child from any thread.
pub struct SessionHandle {
    /// Directory this session was spawned in (for `list_sessions`).
    pub dir_path: String,
    /// Master side of the PTY; used to resize the terminal.
    pub master: Box<dyn MasterPty + Send>,
    /// Writer into the PTY master; used by `write_session`.
    pub writer: Box<dyn Write + Send>,
    /// Killer handle for the spawned child; used by `kill_session`.
    pub killer: Box<dyn ChildKiller + Send + Sync>,
    /// Bounded scrollback of the most recent PTY output (see
    /// [`OUTPUT_BUFFER_CAP`]). The reader thread holds a clone and appends to
    /// it; read in-process via [`SessionRegistry::recent_output`].
    pub output: OutputBuffer,
    /// Whether this is a workspace pane or the Commander.
    pub kind: SessionKind,
    /// Whether the session is currently OS-suspended (SIGSTOP). Phase 2.
    pub paused: bool,
}

impl SessionHandle {
    /// Write input bytes to the PTY master.
    pub fn write(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.writer.write_all(data)?;
        self.writer.flush()
    }

    /// Resize the PTY to the given column/row dimensions.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    /// Terminate the spawned child process.
    pub fn kill(&mut self) -> std::io::Result<()> {
        self.killer.kill()
    }
}

/// Managed state tracking live PTY sessions, keyed by session id.
///
/// `sessions` is an `Arc<Mutex<..>>` so the spawn path can hand a cheap clone
/// (see [`SessionRegistry::share`]) to the per-session reader/waiter threads;
/// every clone points at the same underlying map, so a removal on the waiter
/// thread is observed by the managed state and vice versa.
#[derive(Default, Clone)]
pub struct SessionRegistry {
    pub sessions: SharedSessions,
}

impl SessionRegistry {
    /// A clone-able handle over the same underlying session map, suitable for
    /// moving into background threads.
    pub fn share(&self) -> SharedSessions {
        self.sessions.clone()
    }

    /// Remove a session handle by id, returning it if present.
    pub fn remove(&self, id: &str) -> Option<SessionHandle> {
        self.sessions.lock().unwrap().remove(id)
    }

    /// Recent output of a session, decoded with [`String::from_utf8_lossy`].
    ///
    /// Returns the last `last_bytes` bytes of the scrollback (the whole buffer
    /// when `None`), or `None` if no session with `session_id` is registered.
    /// Decoding may split a UTF-8 sequence at the tail boundary, yielding
    /// replacement chars — acceptable for the in-process MCP reader.
    ///
    /// Consumed in-process by the `mechsuit-mcp-server` (the
    /// `read_session_output` tool).
    pub fn recent_output(&self, session_id: &str, last_bytes: Option<usize>) -> Option<String> {
        let sessions = self.sessions.lock().unwrap();
        let buffer = sessions.get(session_id)?.output.clone();
        // Release the sessions lock before locking the per-buffer mutex.
        drop(sessions);

        let buf = buffer.lock().unwrap();
        let start = match last_bytes {
            Some(n) => buf.len().saturating_sub(n),
            None => 0,
        };
        let bytes: Vec<u8> = buf.iter().skip(start).copied().collect();
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Whether a session with the given id is currently registered.
    ///
    /// Used by the test harness to assert add/remove lifecycle; the runtime
    /// command paths lock the map directly.
    #[cfg(test)]
    pub fn contains(&self, id: &str) -> bool {
        self.sessions.lock().unwrap().contains_key(id)
    }

    /// Number of live sessions. Test-only (see [`SessionRegistry::contains`]).
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }

    /// True when there are no live sessions. Test-only.
    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
