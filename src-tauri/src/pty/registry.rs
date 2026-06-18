//! Session registry.
//!
//! Holds the live PTY sessions keyed by session id. Each [`SessionHandle`]
//! owns the master PTY (used for resize), a writer for input, and a child
//! killer used to terminate the process. The whole map lives behind a
//! `Mutex` and is shared via Tauri managed state.

use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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

/// Stitches a raw PTY byte stream into chunks that are always safe to decode as
/// UTF-8, so a multi-byte sequence (box-drawing glyphs, emoji — exactly what an
/// agent TUI prints) is never split across a `read()` boundary into `�`
/// replacement characters.
///
/// The reader thread reads up to tens of KiB per syscall, and a burst of output
/// can land a `read()` boundary in the middle of a multi-byte sequence. Decoding
/// each raw chunk independently with [`String::from_utf8_lossy`] then turns both
/// halves into replacement chars. `Utf8Stream` holds back an incomplete trailing
/// sequence and prepends it to the next chunk, so each emitted slice ends on a
/// character boundary. A genuinely invalid byte (one that can never complete) is
/// surfaced immediately rather than buffered forever, so a single bad byte can't
/// freeze a pane.
#[derive(Default)]
pub struct Utf8Stream {
    /// Bytes of an incomplete trailing UTF-8 sequence carried to the next chunk.
    /// At most three bytes (a UTF-8 sequence is ≤ 4 bytes), so this stays tiny.
    leftover: Vec<u8>,
}

/// Length of the longest prefix of `bytes` that is safe to decode as UTF-8 now.
/// Holds back ONLY an incomplete multi-byte sequence at the very end; a
/// genuinely invalid sequence mid-buffer is included (so it decodes lossily
/// downstream) rather than stalling the stream forever.
fn utf8_safe_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(e) => match e.error_len() {
            // `None` => the bytes from `valid_up_to()` onward are a valid but
            // incomplete sequence still awaiting continuation bytes: hold them.
            None => e.valid_up_to(),
            // `Some(_)` => an actually invalid sequence; emit everything and let
            // lossy decoding replace it, so one bad byte can't freeze the pane.
            Some(_) => bytes.len(),
        },
    }
}

impl Utf8Stream {
    /// Feed a raw chunk; return the leading bytes now safe to decode as UTF-8.
    /// May be empty when the chunk only extends an incomplete trailing sequence.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<u8> {
        // Prepend any sequence we held back, then split off the part that is
        // safe to decode now, retaining only a still-incomplete trailing tail.
        let mut bytes = std::mem::take(&mut self.leftover);
        bytes.extend_from_slice(chunk);
        let safe = utf8_safe_prefix_len(&bytes);
        self.leftover = bytes.split_off(safe);
        bytes
    }

    /// Surface any held-back bytes at stream end. A tail still incomplete at EOF
    /// is genuinely truncated, so it is returned to be decoded lossily rather
    /// than silently dropped.
    pub fn flush(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.leftover)
    }
}

/// Default PTY geometry a session is spawned at; the frontend resizes it to the
/// real pane size shortly after (which also resizes the vt100 parser).
pub const DEFAULT_ROWS: u16 = 24;
pub const DEFAULT_COLS: u16 = 80;

/// A vt100 terminal emulator fed the same bytes as the raw scrollback, behind a
/// mutex so the reader thread can `process` into it while the MCP server renders
/// from it. This is what lets Commander read the RENDERED screen (cursor moves,
/// spinner repaints, and SGR codes applied) instead of raw byte noise.
pub type ScreenParser = Arc<Mutex<vt100::Parser>>;

/// The per-session output sinks, created together so the spawn path and the test
/// harness build them identically: the raw byte ring, the vt100 parser (seeded
/// at `rows`x`cols`, no scrollback — only the visible screen is rendered), and a
/// last-output clock that drives the working/idle classification.
pub fn new_output_state(rows: u16, cols: u16) -> (OutputBuffer, ScreenParser, Arc<Mutex<Instant>>) {
    (
        OutputBuffer::default(),
        Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 0))),
        Arc::new(Mutex::new(Instant::now())),
    )
}

/// Record a PTY output chunk into all three per-session sinks: the bounded byte
/// ring (raw scrollback), the vt100 parser (rendered screen), and the
/// last-output clock. Called by the reader thread on each chunk it streams, so a
/// snapshot taken at any moment reflects the latest bytes.
pub fn record_output(
    buffer: &OutputBuffer,
    screen: &ScreenParser,
    last_output: &Arc<Mutex<Instant>>,
    chunk: &[u8],
) {
    append_output(buffer, chunk);
    screen.lock().unwrap().process(chunk);
    *last_output.lock().unwrap() = Instant::now();
}

/// A rendered point-in-time view of a session's terminal plus the signals the
/// status heuristics need. Produced by [`SessionRegistry::screen_snapshot`] and
/// consumed by `mcp::screen` to derive the structured snapshot fields.
pub struct ScreenSnapshot {
    /// The directory the session belongs to (title fallback).
    pub dir_path: String,
    /// The rendered visible screen — escape codes applied, trailing blank space
    /// trimmed by vt100.
    pub text: String,
    /// The OSC window title the program set (often the cwd or current task);
    /// empty when none was set.
    pub title: String,
    /// Zero-based cursor row on the rendered screen.
    pub cursor_row: u16,
    /// Time since the last PTY output — the working/idle signal.
    pub idle_for: Duration,
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
    /// vt100 emulator fed the same bytes as `output`; rendered in-process via
    /// [`SessionRegistry::screen_snapshot`] for the Commander observability
    /// tools. The reader thread holds a clone and processes into it.
    pub screen: ScreenParser,
    /// When the reader thread last appended output. Drives the working/idle
    /// classification (a session quiet for ~2s is idle). Shared clone held by
    /// the reader thread.
    pub last_output: Arc<Mutex<Instant>>,
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

    /// Resize the PTY to the given column/row dimensions, keeping the vt100
    /// parser in lock-step so the rendered screen matches the live pane size.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        self.screen.lock().unwrap().set_size(rows, cols);
        Ok(())
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

    /// A rendered snapshot of a session's terminal, or `None` if no session with
    /// `session_id` is registered.
    ///
    /// Unlike [`recent_output`](Self::recent_output) (raw bytes), this returns
    /// the vt100-rendered visible screen with cursor moves and repaints applied,
    /// the OSC title, the cursor row, and how long the session has been quiet —
    /// everything `mcp::screen` needs to derive the structured snapshot the
    /// Commander reads.
    pub fn screen_snapshot(&self, session_id: &str) -> Option<ScreenSnapshot> {
        let sessions = self.sessions.lock().unwrap();
        let handle = sessions.get(session_id)?;
        let dir_path = handle.dir_path.clone();
        let screen = handle.screen.clone();
        let last_output = handle.last_output.clone();
        // Release the sessions lock before locking the per-session sinks.
        drop(sessions);

        let (text, title, cursor_row) = {
            let parser = screen.lock().unwrap();
            let scr = parser.screen();
            (scr.contents(), scr.title().to_string(), scr.cursor_position().0)
        };
        let idle_for = last_output.lock().unwrap().elapsed();

        Some(ScreenSnapshot { dir_path, text, title, cursor_row, idle_for })
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A multi-byte UTF-8 sequence split across two chunks at ANY byte boundary
    /// must be stitched back together — never surfacing a `�` replacement char.
    /// This is the terminal glitch: a 64K `read()` landing mid-glyph.
    #[test]
    fn utf8_stream_stitches_multibyte_sequence_split_across_chunks() {
        // Box-drawing + check + rocket + ellipsis: exactly the glyph classes an
        // agent TUI prints, and the ones that broke into `�` mid-sequence.
        let original = "┌─┐ build ✓ 🚀 │ working…";
        let bytes = original.as_bytes();

        for split in 1..bytes.len() {
            let mut stream = Utf8Stream::default();
            let mut out = String::new();
            out.push_str(&String::from_utf8_lossy(&stream.push(&bytes[..split])));
            out.push_str(&String::from_utf8_lossy(&stream.push(&bytes[split..])));
            out.push_str(&String::from_utf8_lossy(&stream.flush()));

            assert!(
                !out.contains('\u{FFFD}'),
                "split at byte {split} produced a replacement char: {out:?}",
            );
            assert_eq!(out, original, "split at byte {split} corrupted the stream");
        }
    }

    /// An incomplete lead byte is held back (emitted empty) until completed; if
    /// the stream ends there, `flush` surfaces it lossily rather than dropping it.
    #[test]
    fn utf8_stream_holds_then_flushes_truncated_tail() {
        let mut stream = Utf8Stream::default();
        let rocket = "🚀".as_bytes(); // 4 bytes
        let held = stream.push(&rocket[..1]);
        assert!(held.is_empty(), "incomplete lead byte must be held, not emitted");
        let flushed = stream.flush();
        assert_eq!(String::from_utf8_lossy(&flushed), "\u{FFFD}");
    }

    /// A byte that can NEVER start a valid sequence (0xFF) is surfaced
    /// immediately as a replacement char, not buffered forever — otherwise one
    /// bad byte would freeze the pane.
    #[test]
    fn utf8_stream_does_not_stall_on_a_genuinely_invalid_byte() {
        let mut stream = Utf8Stream::default();
        let out = stream.push(&[b'a', 0xFF, b'b']);
        assert_eq!(String::from_utf8_lossy(&out), "a\u{FFFD}b");
        assert!(stream.flush().is_empty(), "nothing should be held back");
    }
}
