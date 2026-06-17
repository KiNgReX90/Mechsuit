//! In-process MCP server exposing mechsuit's session capabilities.
//!
//! A spawned headless `claude` (the Commander, see `commander-claude-driver`)
//! cannot reach mechsuit over stdio because mechsuit is the *host*, not a
//! subprocess. Instead we host an MCP server inside the Tauri process, served
//! over **streamable-HTTP bound to `127.0.0.1`** on an OS-assigned free port.
//! The driver builds its `--mcp-config` from the bound [`SocketAddr`] returned
//! by [`start`] (URL `http://127.0.0.1:<port>/mcp`, transport type `http`).
//!
//! The server shares the live [`SessionRegistry`] and the `AppHandle` with the
//! Tauri commands — no new persistence — and exposes these tools:
//!
//! - [`resolve_project`](MechsuitServer::resolve_project) — match a managed
//!   directory by name or branch and emit [`COMMANDER_NAVIGATE`] on a hit.
//! - [`list_sessions`](MechsuitServer::list_sessions) — a directory's live
//!   sessions (same shape as the `list_sessions` command).
//! - [`read_session_output`](MechsuitServer::read_session_output) — recent
//!   scrollback via [`SessionRegistry::recent_output`].
//! - [`send_to_session`](MechsuitServer::send_to_session) — write text to a
//!   session's PTY (same path as the `write_session` command).
//! - [`discover_projects`](MechsuitServer::discover_projects) — bounded walk of
//!   a root (default `~/dev`) for candidate session-group directories.
//! - [`add_project`](MechsuitServer::add_project) — add a directory to the
//!   managed store (same path as the `add_directory` command).
//! - [`remove_project`](MechsuitServer::remove_project) — confirm-gated removal
//!   that kills the directory's live sessions then drops the managed entry.
//!
//! Tool dispatch is registered via rmcp's `#[tool_router]`/`#[tool]` macros so a
//! later item (`commander-workspace-tools`) can extend the router with more
//! tools by adding `#[tool]` methods.

use std::net::SocketAddr;
use std::sync::Arc;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, Content, ServerCapabilities, ServerInfo};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{tool, tool_handler, tool_router, ErrorData, ServerHandler};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::directory::DiscoveredDir;
use crate::events::{COMMANDER_DIRECTORIES_CHANGED, COMMANDER_NAVIGATE, SESSION_PAUSED, PausedEvent};
use crate::models::{DirectoryInfo, SessionInfo};
use crate::pty::SessionRegistry;

/// Default bounded walk depth when `discover_projects` is called without
/// `depth`. Matches the directory module's bounded-walk convention.
const DEFAULT_DISCOVER_DEPTH: usize = 2;

/// Path the MCP HTTP surface is mounted at; the driver's `--mcp-config` URL is
/// `http://{addr}{MCP_PATH}`.
pub const MCP_PATH: &str = "/mcp";

/// Managed-state holder for the MCP server's bound address, so the Commander
/// driver (`commander-claude-driver`) can read it to build its `--mcp-config`.
/// The full MCP URL is `http://{0}{MCP_PATH}`.
///
/// Read by `commander::spawn_commander_session` to build the `--mcp-config` URL.
pub struct McpServerAddr(pub SocketAddr);

/// Source of the managed directory list backing `resolve_project`.
///
/// In the running app this reads the persisted directory store via the
/// `AppHandle`; tests supply a fixed list. Boxed trait object so the server is
/// agnostic to where directories come from.
pub trait DirectorySource: Send + Sync + 'static {
    /// The currently managed directories (path + name + branch).
    fn directories(&self) -> Vec<DirectoryInfo>;
}

/// [`DirectorySource`] backed by the Tauri directory store (the same list
/// `list_directories` returns). Git status is re-evaluated per call, matching
/// the command path.
struct AppDirectorySource {
    app: AppHandle,
}

impl DirectorySource for AppDirectorySource {
    fn directories(&self) -> Vec<DirectoryInfo> {
        crate::directory::list_directories(self.app.clone()).unwrap_or_default()
    }
}

/// Mutating access to the persisted managed-directory store, backing
/// `add_project`/`remove_project`.
///
/// Split from the read-only [`DirectorySource`] so the running app can persist
/// against the Tauri app-data store while tests drive a temp store — neither
/// re-implements the persistence logic, which lives in
/// `crate::directory::persist`.
pub trait DirectoryStore: Send + Sync + 'static {
    /// Add `path` to the managed store (dedup no-op if already present),
    /// returning its freshly-detected [`DirectoryInfo`].
    fn add(&self, path: &str) -> Result<DirectoryInfo, String>;
    /// Remove `path` from the managed store (no error if it was absent).
    fn remove(&self, path: &str) -> Result<(), String>;
}

/// [`DirectoryStore`] backed by the Tauri app-data JSON store — the same store
/// the `add_directory`/`remove_directory` commands write — via
/// `crate::directory::persist`.
struct AppDirectoryStore {
    app: AppHandle,
}

impl DirectoryStore for AppDirectoryStore {
    fn add(&self, path: &str) -> Result<DirectoryInfo, String> {
        let dir = crate::directory::data_dir(&self.app)?;
        crate::directory::persist::add(&dir, path.to_string())
    }

    fn remove(&self, path: &str) -> Result<(), String> {
        let dir = crate::directory::data_dir(&self.app)?;
        crate::directory::persist::remove(&dir, path.to_string())
    }
}

/// Sink for Commander-initiated UI side effects, emitted as Tauri events.
///
/// In the running app these emit over the `AppHandle`; tests record them so the
/// side effects are observable without a Tauri runtime.
pub trait CommanderEvents: Send + Sync + 'static {
    /// Request the UI select the directory at `dir_path`
    /// (emits [`COMMANDER_NAVIGATE`]).
    fn navigate(&self, dir_path: &str);
    /// Signal that the managed directory list changed — an `add_project` /
    /// `remove_project` mutated it — so the sidebar reloads it
    /// (emits [`COMMANDER_DIRECTORIES_CHANGED`]).
    fn directories_changed(&self);
    /// Signal that a session was paused/resumed so the UI can reflect it
    /// (emits [`crate::events::SESSION_PAUSED`]).
    fn session_paused(&self, session_id: &str, paused: bool);
}

/// [`CommanderEvents`] that emits the Commander Tauri events over the app handle.
struct AppCommanderEvents {
    app: AppHandle,
}

impl CommanderEvents for AppCommanderEvents {
    fn navigate(&self, dir_path: &str) {
        let _ = self.app.emit(COMMANDER_NAVIGATE, dir_path);
    }

    fn directories_changed(&self) {
        let _ = self.app.emit(COMMANDER_DIRECTORIES_CHANGED, ());
    }

    fn session_paused(&self, session_id: &str, paused: bool) {
        let _ = self.app.emit(
            SESSION_PAUSED,
            PausedEvent { session_id: session_id.to_string(), paused },
        );
    }
}

// ---- Tool parameter shapes -------------------------------------------------
//
// camelCase via serde so the JSON-RPC field names match what the Commander
// (a `claude` client) sends per the tool input schema.

/// Parameters for `resolve_project`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveProjectParams {
    /// A directory name or git branch to match (case-insensitive).
    pub query: String,
}

/// Parameters for `list_sessions`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsParams {
    /// Absolute path of the managed directory whose sessions to list.
    pub dir_path: String,
}

/// Parameters for `read_session_output`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadSessionOutputParams {
    /// Id of the session to read.
    pub session_id: String,
    /// Optional cap: return only the last N bytes of scrollback. Omit for the
    /// whole buffer.
    #[serde(default)]
    pub last_bytes: Option<usize>,
}

/// Parameters for `send_to_session`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendToSessionParams {
    /// Id of the session to write to.
    pub session_id: String,
    /// Text written verbatim to the session's PTY input.
    pub text: String,
}

/// Parameters for `discover_projects`. Both fields are optional; omitting them
/// uses the user's `~/dev` root and the bounded default depth.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverProjectsParams {
    /// Root directory to walk. Defaults to the user's `~/dev` when omitted.
    #[serde(default)]
    pub root: Option<String>,
    /// Bounded walk depth. Defaults to a small bounded value when omitted.
    #[serde(default)]
    pub depth: Option<usize>,
}

/// Parameters for `add_project`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectParams {
    /// Absolute path of the directory to add to the managed list.
    pub path: String,
}

/// Parameters for `remove_project`.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProjectParams {
    /// A directory name, git branch, or path to resolve to a managed entry.
    pub query: String,
    /// Must be `true` to proceed when the directory has live sessions. Omitted
    /// or `false` returns `confirmationRequired` without changing anything.
    #[serde(default)]
    pub confirm: bool,
}

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

// ---- Pure tool logic (testable without a Tauri runtime) --------------------

/// Match the managed directory whose `name` or `branch` matches `query`
/// case-insensitively, preferring an exact match over a substring match
/// (`None` when nothing matches). Pure lookup with no side effect — shared by
/// [`resolve_project`] (which navigates) and `remove_project` (which must not).
pub fn match_project(dirs: &[DirectoryInfo], query: &str) -> Option<DirectoryInfo> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return None;
    }

    let matches_field = |field: &str, exact: bool| {
        let f = field.to_lowercase();
        if exact {
            f == q
        } else {
            f.contains(&q)
        }
    };

    let hit = |exact: bool| {
        dirs.iter().find(|d| {
            matches_field(&d.name, exact)
                || d.branch.as_deref().is_some_and(|b| matches_field(b, exact))
        })
    };

    // Exact (name or branch) first; fall back to substring.
    hit(true).or_else(|| hit(false)).cloned()
}

/// Find the managed directory whose `name` or `branch` matches `query`
/// (see [`match_project`]). On a hit, `sink.navigate(path)` fires so the UI
/// selects the directory.
pub fn resolve_project(
    dirs: &[DirectoryInfo],
    query: &str,
    sink: &dyn CommanderEvents,
) -> Option<DirectoryInfo> {
    let found = match_project(dirs, query);
    if let Some(dir) = &found {
        sink.navigate(&dir.path);
    }
    found
}

/// Outcome of a `remove_project` call.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoveProjectOutcome {
    /// `query` matched no managed directory.
    NotFound,
    /// The directory has live sessions and `confirm` was not set; nothing
    /// changed. Carries the impact so the persona can warn the user.
    NeedsConfirmation {
        confirmation_required: bool,
        active_sessions: usize,
        path: String,
        name: String,
    },
    /// The directory was removed (after killing `killed_sessions` live ones).
    Removed {
        removed: bool,
        killed_sessions: usize,
        path: String,
    },
}

/// Resolve `query` to a managed directory and either remove it or report that
/// confirmation is required.
///
/// With live sessions and `confirm == false`, returns
/// [`RemoveProjectOutcome::NeedsConfirmation`] and changes nothing. Otherwise
/// (no live sessions, or `confirm == true`) it kills the directory's sessions
/// via the registry and `store.remove`s the entry.
pub fn remove_project(
    registry: &SessionRegistry,
    store: &dyn DirectoryStore,
    dirs: &[DirectoryInfo],
    query: &str,
    confirm: bool,
) -> Result<RemoveProjectOutcome, String> {
    let dir = match match_project(dirs, query) {
        Some(d) => d,
        None => return Ok(RemoveProjectOutcome::NotFound),
    };

    // Ids of this directory's live sessions (filter the shared registry by dir).
    let session_ids: Vec<String> = {
        let sessions = registry.sessions.lock().unwrap();
        sessions
            .iter()
            .filter(|(_, h)| h.dir_path == dir.path)
            .map(|(id, _)| id.clone())
            .collect()
    };

    if !session_ids.is_empty() && !confirm {
        return Ok(RemoveProjectOutcome::NeedsConfirmation {
            confirmation_required: true,
            active_sessions: session_ids.len(),
            path: dir.path.clone(),
            name: dir.name.clone(),
        });
    }

    // Confirmed (or nothing live): kill each session, then drop the entry.
    let mut killed = 0;
    for id in &session_ids {
        if let Some(mut handle) = registry.remove(id) {
            let _ = handle.kill();
            killed += 1;
        }
    }
    store.remove(&dir.path)?;

    Ok(RemoveProjectOutcome::Removed {
        removed: true,
        killed_sessions: killed,
        path: dir.path,
    })
}

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

/// The live sessions belonging to `dir_path` (same filtering as the
/// `list_sessions` command).
pub fn list_sessions_for(registry: &SessionRegistry, dir_path: &str) -> Vec<SessionInfo> {
    let sessions = registry.sessions.lock().unwrap();
    sessions
        .iter()
        .filter(|(_, h)| h.dir_path == dir_path)
        .map(|(id, h)| SessionInfo {
            id: id.clone(),
            dir_path: h.dir_path.clone(),
            kind: h.kind,
        })
        .collect()
}

/// Write `text` to the session's PTY master (same path as `write_session`).
/// `Err(message)` for an unknown session id or a write failure.
pub fn send_to_session(
    registry: &SessionRegistry,
    session_id: &str,
    text: &str,
) -> Result<(), String> {
    let mut sessions = registry.sessions.lock().unwrap();
    let handle = sessions
        .get_mut(session_id)
        .ok_or_else(|| format!("no such session: {session_id}"))?;
    handle.write(text.as_bytes()).map_err(|e| e.to_string())
}

// ---- MCP server handler ----------------------------------------------------

/// MCP server backed by the live [`SessionRegistry`] + a [`DirectorySource`]
/// and a [`NavigateSink`]. Cheaply cloneable (everything is an `Arc`); a fresh
/// clone is handed to each streamable-HTTP session by the service factory.
#[derive(Clone)]
pub struct MechsuitServer {
    registry: SessionRegistry,
    dirs: Arc<dyn DirectorySource>,
    store: Arc<dyn DirectoryStore>,
    events: Arc<dyn CommanderEvents>,
    /// Tool dispatch table built by `#[tool_router]` and consumed by the
    /// `#[tool_handler]`-generated `ServerHandler` impl. The macro reads it via
    /// generated trait methods, which the unused-field lint does not attribute
    /// as a direct read — hence the allow.
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl MechsuitServer {
    /// Build a server from already-shared state. Used by [`start`] and tests.
    pub fn new(
        registry: SessionRegistry,
        dirs: Arc<dyn DirectorySource>,
        store: Arc<dyn DirectoryStore>,
        events: Arc<dyn CommanderEvents>,
    ) -> Self {
        Self {
            registry,
            dirs,
            store,
            events,
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl MechsuitServer {
    #[tool(
        description = "Resolve a managed project directory by name or git branch \
        (case-insensitive, exact preferred over substring) and navigate the UI to \
        it. Returns the matched directory, or null when nothing matches."
    )]
    fn resolve_project(
        &self,
        Parameters(ResolveProjectParams { query }): Parameters<ResolveProjectParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let dirs = self.dirs.directories();
        let matched = resolve_project(&dirs, &query, self.events.as_ref());
        json_result(&matched)
    }

    #[tool(description = "List the live PTY sessions for a managed directory path.")]
    fn list_sessions(
        &self,
        Parameters(ListSessionsParams { dir_path }): Parameters<ListSessionsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let sessions = list_sessions_for(&self.registry, &dir_path);
        json_result(&sessions)
    }

    #[tool(
        description = "Read a session's recent terminal output (scrollback). Pass \
        lastBytes to cap the tail; omit it for the whole buffer."
    )]
    fn read_session_output(
        &self,
        Parameters(ReadSessionOutputParams {
            session_id,
            last_bytes,
        }): Parameters<ReadSessionOutputParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.registry.recent_output(&session_id, last_bytes) {
            Some(text) => Ok(CallToolResult::success(vec![Content::text(text)])),
            None => Err(unknown_session(&session_id)),
        }
    }

    #[tool(description = "Write text to a session's PTY input (e.g. send a prompt or keystrokes).")]
    fn send_to_session(
        &self,
        Parameters(SendToSessionParams { session_id, text }): Parameters<SendToSessionParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match send_to_session(&self.registry, &session_id, &text) {
            Ok(()) => Ok(CallToolResult::success(vec![Content::text("ok")])),
            Err(msg) => Err(ErrorData::invalid_params(msg, None)),
        }
    }

    #[tool(
        description = "Discover candidate session-group directories (git repos and \
        plain dirs) under a root. root defaults to the user's ~/dev and depth to a \
        bounded default; each candidate carries branch, lastModified, and \
        alreadyManaged. Non-destructive."
    )]
    fn discover_projects(
        &self,
        Parameters(DiscoverProjectsParams { root, depth }): Parameters<DiscoverProjectsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let root = root.unwrap_or_else(crate::settings::default_workspace_root);
        let depth = depth.unwrap_or(DEFAULT_DISCOVER_DEPTH);
        let managed: Vec<String> = self.dirs.directories().into_iter().map(|d| d.path).collect();
        let found: Vec<DiscoveredDir> = crate::directory::discover(&root, depth, &managed);
        json_result(&found)
    }

    #[tool(
        description = "Add a directory to the managed list (dedup no-op if already \
        managed) and return its info. Direct and non-destructive."
    )]
    fn add_project(
        &self,
        Parameters(AddProjectParams { path }): Parameters<AddProjectParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.store.add(&path) {
            Ok(info) => {
                // Tell the sidebar to reload so a Commander-driven add shows up
                // live instead of only living in the persisted store.
                self.events.directories_changed();
                json_result(&info)
            }
            Err(msg) => Err(ErrorData::invalid_params(msg, None)),
        }
    }

    #[tool(
        description = "Remove a managed directory resolved by name, branch, or path. \
        DESTRUCTIVE: if the directory has live sessions and confirm is not true, \
        returns { confirmationRequired: true, activeSessions: N } and changes \
        nothing. With confirm true (or no live sessions) it kills the directory's \
        sessions and removes the entry. Requires explicit user confirmation first."
    )]
    fn remove_project(
        &self,
        Parameters(RemoveProjectParams { query, confirm }): Parameters<RemoveProjectParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let dirs = self.dirs.directories();
        match remove_project(&self.registry, self.store.as_ref(), &dirs, &query, confirm) {
            Ok(outcome) => {
                // Only an actual removal changed the list; a NeedsConfirmation /
                // NotFound outcome left it untouched, so don't reload then.
                if matches!(outcome, RemoveProjectOutcome::Removed { .. }) {
                    self.events.directories_changed();
                }
                json_result(&outcome)
            }
            Err(msg) => Err(ErrorData::internal_error(msg, None)),
        }
    }

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
}

#[tool_handler]
impl ServerHandler for MechsuitServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions(
                "mechsuit session tools: resolve_project, list_sessions, \
                read_session_output, send_to_session, discover_projects, \
                add_project, remove_project, pause_sessions, resume_sessions.",
            )
    }
}

/// Standard MCP error for an unknown session id.
fn unknown_session(session_id: &str) -> ErrorData {
    ErrorData::invalid_params(format!("no such session: {session_id}"), None)
}

/// Serialize a value to a JSON text content block. Serialization failure maps
/// to an MCP internal error (should not happen for our own types).
fn json_result<T: serde::Serialize>(value: &T) -> Result<CallToolResult, ErrorData> {
    let json = serde_json::to_string(value)
        .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
    Ok(CallToolResult::success(vec![Content::text(json)]))
}

/// Start the MCP server bound to `127.0.0.1` on an OS-assigned free port,
/// returning the bound [`SocketAddr`] (for the driver's `--mcp-config`).
///
/// The server runs on its own multi-thread tokio runtime in a dedicated thread
/// so it does not require the Tauri runtime to be tokio-based; the runtime is
/// leaked for the lifetime of the process (the server lives as long as the
/// app). The directory list is read live via the `AppHandle` and the navigate
/// side effect emits [`COMMANDER_NAVIGATE`].
pub fn start(registry: SessionRegistry, app: AppHandle) -> Result<SocketAddr, String> {
    let dirs: Arc<dyn DirectorySource> = Arc::new(AppDirectorySource { app: app.clone() });
    let store: Arc<dyn DirectoryStore> = Arc::new(AppDirectoryStore { app: app.clone() });
    let events: Arc<dyn CommanderEvents> = Arc::new(AppCommanderEvents { app });
    let server = MechsuitServer::new(registry, dirs, store, events);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("failed to build MCP runtime: {e}"))?;

    // Bind synchronously so we can return the real port to the caller before
    // the serve loop starts.
    let listener = runtime
        .block_on(async { tokio::net::TcpListener::bind(("127.0.0.1", 0)).await })
        .map_err(|e| format!("failed to bind MCP listener: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("failed to read MCP bound address: {e}"))?;

    // Serve on the leaked runtime for the app's lifetime.
    let runtime = Box::leak(Box::new(runtime));
    runtime.spawn(async move {
        let service = StreamableHttpService::new(
            move || Ok(server.clone()),
            Arc::new(LocalSessionManager::default()),
            StreamableHttpServerConfig::default(),
        );
        let router = axum::Router::new().nest_service(MCP_PATH, service);
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("MCP server stopped: {e}");
        }
    });

    Ok(addr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::sync::Mutex as StdMutex;
    use std::thread;
    use std::time::{Duration, Instant};

    use std::path::PathBuf;

    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    use crate::pty::{append_output, OutputBuffer, SessionHandle, SessionRegistry};

    /// Directory fixture: a fixed list, no persistence / git.
    struct FixedDirs(Vec<DirectoryInfo>);
    impl DirectorySource for FixedDirs {
        fn directories(&self) -> Vec<DirectoryInfo> {
            self.0.clone()
        }
    }

    /// A throwaway directory under the OS temp dir, removed on drop. Mirrors the
    /// helper in `persist.rs`/`discover.rs` to avoid a `tempfile` dependency.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(tag: &str) -> Self {
            let unique = format!(
                "mechsuit-mcp-test-{tag}-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let path = std::env::temp_dir().join(unique);
            std::fs::create_dir_all(&path).unwrap();
            TempDir { path }
        }
        fn path_str(&self) -> String {
            self.path.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// [`DirectoryStore`] backed by a temp JSON store via `directory::persist`,
    /// exercising the real persistence path without a Tauri `AppHandle`. Also
    /// records the last removed path so removal is assertable directly.
    struct TempStore {
        data_dir: PathBuf,
        removed: StdMutex<Vec<String>>,
    }

    impl TempStore {
        fn new(data_dir: PathBuf) -> Self {
            TempStore {
                data_dir,
                removed: StdMutex::new(Vec::new()),
            }
        }
    }

    impl DirectoryStore for TempStore {
        fn add(&self, path: &str) -> Result<DirectoryInfo, String> {
            crate::directory::persist::add(&self.data_dir, path.to_string())
        }
        fn remove(&self, path: &str) -> Result<(), String> {
            self.removed.lock().unwrap().push(path.to_string());
            crate::directory::persist::remove(&self.data_dir, path.to_string())
        }
    }

    /// Records every navigated path (`.0`), counts directories-changed
    /// signals (`.1`), and records session_paused side effects (`.2`) so all
    /// side effects are assertable without a Tauri runtime.
    #[derive(Default)]
    struct RecordingSink(StdMutex<Vec<String>>, StdMutex<usize>, StdMutex<Vec<(String, bool)>>);
    impl CommanderEvents for RecordingSink {
        fn navigate(&self, dir_path: &str) {
            self.0.lock().unwrap().push(dir_path.to_string());
        }
        fn directories_changed(&self) {
            *self.1.lock().unwrap() += 1;
        }
        fn session_paused(&self, session_id: &str, paused: bool) {
            self.2.lock().unwrap().push((session_id.to_string(), paused));
        }
    }

    fn dir(path: &str, name: &str, branch: Option<&str>) -> DirectoryInfo {
        DirectoryInfo {
            path: path.to_string(),
            name: name.to_string(),
            is_git_repo: branch.is_some(),
            branch: branch.map(|b| b.to_string()),
            last_modified: None,
        }
    }

    fn fixture() -> Vec<DirectoryInfo> {
        vec![
            dir("/work/alpha", "alpha", Some("main")),
            dir("/work/beta", "beta", Some("feature-x")),
            dir("/work/gamma", "gamma", None),
        ]
    }

    /// resolve_project: exact name match, branch match, and a miss; the navigate
    /// side effect fires only on a hit, with the matched directory's path.
    #[test]
    fn resolve_project_matches_name_branch_and_misses() {
        let dirs = fixture();

        // Exact name (case-insensitive) → /work/beta, navigate fired.
        let sink = RecordingSink::default();
        let hit = resolve_project(&dirs, "BETA", &sink);
        assert_eq!(hit.as_ref().map(|d| d.path.as_str()), Some("/work/beta"));
        assert_eq!(sink.0.lock().unwrap().as_slice(), ["/work/beta"]);

        // Branch match → /work/alpha (branch "main").
        let sink = RecordingSink::default();
        let hit = resolve_project(&dirs, "main", &sink);
        assert_eq!(hit.as_ref().map(|d| d.path.as_str()), Some("/work/alpha"));
        assert_eq!(sink.0.lock().unwrap().as_slice(), ["/work/alpha"]);

        // Substring branch match → /work/beta (branch "feature-x").
        let sink = RecordingSink::default();
        let hit = resolve_project(&dirs, "feature", &sink);
        assert_eq!(hit.as_ref().map(|d| d.path.as_str()), Some("/work/beta"));

        // Exact preferred over substring: "alpha" also substring-matches nothing
        // else, but an exact name win is deterministic.
        let sink = RecordingSink::default();
        let hit = resolve_project(&dirs, "alpha", &sink);
        assert_eq!(hit.as_ref().map(|d| d.path.as_str()), Some("/work/alpha"));

        // Miss → None, navigate did NOT fire.
        let sink = RecordingSink::default();
        assert!(resolve_project(&dirs, "nonexistent", &sink).is_none());
        assert!(sink.0.lock().unwrap().is_empty());
    }

    /// Spawn a real PTY rooted at `dir_path` running the shell, register it, and
    /// wire a reader thread that appends to the scrollback buffer (mirroring the
    /// command path's reader so `recent_output` has data). Returns the session
    /// id. Self-contained because `pty::spawn_pty` is private to that module.
    fn spawn_session(registry: &SessionRegistry, dir_path: &str) -> String {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let mut cmd = CommandBuilder::new(std::env::var("SHELL").unwrap_or("/bin/bash".into()));
        cmd.cwd(dir_path);
        let mut child = pair.slave.spawn_command(cmd).expect("spawn shell");
        drop(pair.slave);

        let killer = child.clone_killer();
        let writer = pair.master.take_writer().expect("writer");
        let mut reader = pair.master.try_clone_reader().expect("reader");
        let output: OutputBuffer = OutputBuffer::default();

        let id = uuid::Uuid::new_v4().to_string();
        registry.sessions.lock().unwrap().insert(
            id.clone(),
            SessionHandle {
                dir_path: dir_path.to_string(),
                master: pair.master,
                writer,
                killer,
                output: output.clone(),
                kind: crate::models::SessionKind::Workspace,
                paused: false,
            },
        );

        // Reader thread appends streamed bytes to the scrollback buffer.
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => append_output(&output, &buf[..n]),
                }
            }
        });
        // Reap the child off-thread so it does not become a zombie.
        thread::spawn(move || {
            let _ = child.wait();
        });
        id
    }

    /// Build a server over an in-memory registry + directory fixture and assert
    /// the tool-backing logic: resolve, list_sessions filtering,
    /// read_session_output tail, and send_to_session writing bytes through the
    /// PTY. Unknown ids surface errors on both read and send.
    #[test]
    fn tool_dispatch_over_in_memory_state() {
        let registry = SessionRegistry::default();
        let sink: Arc<RecordingSink> = Arc::new(RecordingSink::default());
        let dirs: Arc<dyn DirectorySource> = Arc::new(FixedDirs(fixture()));
        let store_dir = TempDir::new("dispatch-store");
        let store: Arc<dyn DirectoryStore> = Arc::new(TempStore::new(store_dir.path.clone()));
        let server = MechsuitServer::new(registry.clone(), dirs, store, sink.clone());

        // resolve_project via the server's directory source.
        let matched = resolve_project(&server.dirs.directories(), "gamma", sink.as_ref());
        assert_eq!(matched.map(|d| d.path), Some("/work/gamma".to_string()));
        assert_eq!(sink.0.lock().unwrap().as_slice(), ["/work/gamma"]);

        // Unknown session: read returns None, send returns Err.
        assert!(registry.recent_output("missing", None).is_none());
        assert!(send_to_session(&registry, "missing", "hi").is_err());

        // Spawn a real PTY so read/write have a live session to act on.
        let id = spawn_session(&registry, "/");

        // list_sessions_for filters by directory.
        let listed = list_sessions_for(&server.registry, "/");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);

        // send_to_session writes bytes that the shell echoes; assert via the
        // scrollback buffer that read_session_output reads.
        send_to_session(&registry, &id, "printf MCP_TOOL_OK\\n; exit 0\n")
            .expect("send_to_session should write");

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut seen = String::new();
        while Instant::now() < deadline {
            if let Some(out) = registry.recent_output(&id, None) {
                seen = out;
                if seen.contains("MCP_TOOL_OK") {
                    break;
                }
            }
            thread::sleep(Duration::from_millis(50));
        }
        assert!(
            seen.contains("MCP_TOOL_OK"),
            "read_session_output should reflect written+echoed text, got: {seen:?}"
        );

        // last_bytes tail is bounded and a suffix of the whole buffer.
        let whole = registry.recent_output(&id, None).unwrap();
        let tail = registry.recent_output(&id, Some(8)).unwrap();
        assert!(tail.len() <= 8);
        assert!(whole.ends_with(&tail));

        if let Some(mut h) = registry.remove(&id) {
            let _ = h.kill();
        }
    }

    /// Build a single git repo under a temp root so discover has a real
    /// candidate. Returns (root TempDir, repo path string).
    fn repo_under_root(root: &TempDir) -> String {
        let repo = root.path.join("proj");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::write(repo.join("README.md"), b"hi").unwrap();
        let repo_str = repo.to_string_lossy().into_owned();
        repo_str
    }

    /// Dispatch the three workspace tools over real shared state:
    /// discover_projects lists candidates with already_managed reflecting the
    /// source; add_project persists through `persist`; remove_project returns
    /// confirmationRequired with active sessions and no confirm, then kills +
    /// removes when confirm is set.
    #[test]
    fn workspace_tools_dispatch_over_shared_state() {
        // ---- discover_projects ----
        // A root holding one plain dir; flag it managed via the source.
        let walk_root = TempDir::new("discover-root");
        let candidate = repo_under_root(&walk_root);
        let managed_dirs = vec![dir(&candidate, "proj", Some("main"))];

        let registry = SessionRegistry::default();
        let sink: Arc<RecordingSink> = Arc::new(RecordingSink::default());
        let dirs: Arc<dyn DirectorySource> = Arc::new(FixedDirs(managed_dirs.clone()));
        let store_dir = TempDir::new("ws-store");
        let store: Arc<TempStore> = Arc::new(TempStore::new(store_dir.path.clone()));
        let server = MechsuitServer::new(
            registry.clone(),
            dirs,
            store.clone() as Arc<dyn DirectoryStore>,
            sink,
        );

        let found = crate::directory::discover(
            &walk_root.path_str(),
            DEFAULT_DISCOVER_DEPTH,
            std::slice::from_ref(&candidate),
        );
        let proj = found
            .iter()
            .find(|d| d.path == candidate)
            .expect("discover should return the candidate dir");
        assert!(proj.already_managed, "managed path flagged already_managed");

        // ---- add_project persists through the store ----
        let to_add = TempDir::new("to-add");
        let added = server.store.add(&to_add.path_str()).expect("add persists");
        assert_eq!(added.path, to_add.path_str());
        let listed = crate::directory::persist::list(&store_dir.path).unwrap();
        assert!(
            listed.iter().any(|d| d.path == to_add.path_str()),
            "added path is persisted in the store"
        );

        // ---- remove_project: needs confirmation while a session is live ----
        // Spawn a real PTY rooted at the managed dir so it has an active session.
        let session = spawn_session(&registry, &candidate);

        let outcome = remove_project(
            &registry,
            server.store.as_ref(),
            &managed_dirs,
            "proj",
            false,
        )
        .expect("remove_project ok");
        match outcome {
            RemoveProjectOutcome::NeedsConfirmation {
                confirmation_required,
                active_sessions,
                path,
                ..
            } => {
                assert!(confirmation_required);
                assert_eq!(active_sessions, 1, "the live session is counted");
                assert_eq!(path, candidate);
            }
            other => panic!("expected NeedsConfirmation, got {other:?}"),
        }
        // Nothing was killed or removed.
        assert!(registry.contains(&session), "session still live without confirm");
        assert!(store.removed.lock().unwrap().is_empty(), "no removal yet");

        // ---- remove_project with confirm: kills the session + removes entry ----
        let outcome = remove_project(
            &registry,
            server.store.as_ref(),
            &managed_dirs,
            "proj",
            true,
        )
        .expect("remove_project ok");
        match outcome {
            RemoveProjectOutcome::Removed {
                removed,
                killed_sessions,
                path,
            } => {
                assert!(removed);
                assert_eq!(killed_sessions, 1, "the live session was killed");
                assert_eq!(path, candidate);
            }
            other => panic!("expected Removed, got {other:?}"),
        }
        assert!(!registry.contains(&session), "session killed on confirm");
        assert_eq!(
            store.removed.lock().unwrap().as_slice(),
            [candidate.as_str()],
            "the resolved path was removed from the store"
        );

        // ---- remove_project: a miss is NotFound, no error ----
        let miss = remove_project(
            &registry,
            server.store.as_ref(),
            &managed_dirs,
            "nonexistent",
            true,
        )
        .expect("remove_project ok");
        assert!(matches!(miss, RemoveProjectOutcome::NotFound));
    }

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

    /// A Commander-driven `add_project` must both persist the directory AND
    /// signal the UI to reload its list — otherwise the add only lands in the
    /// store and the sidebar's once-loaded list stays stale (the reported bug).
    #[test]
    fn add_project_tool_signals_directories_changed() {
        let registry = SessionRegistry::default();
        let sink: Arc<RecordingSink> = Arc::new(RecordingSink::default());
        let dirs: Arc<dyn DirectorySource> = Arc::new(FixedDirs(vec![]));
        let store_dir = TempDir::new("add-signal-store");
        let store: Arc<dyn DirectoryStore> = Arc::new(TempStore::new(store_dir.path.clone()));
        let server = MechsuitServer::new(registry, dirs, store, sink.clone());

        let to_add = TempDir::new("add-signal-dir");
        let result = server.add_project(Parameters(AddProjectParams {
            path: to_add.path_str(),
        }));
        assert!(result.is_ok(), "add_project tool dispatch succeeds");

        // Persisted to the store...
        let listed = crate::directory::persist::list(&store_dir.path).unwrap();
        assert!(
            listed.iter().any(|d| d.path == to_add.path_str()),
            "added directory is persisted"
        );
        // ...and the UI was told to reload exactly once so the sidebar refreshes.
        assert_eq!(
            *sink.1.lock().unwrap(),
            1,
            "add_project emits directories_changed"
        );
    }

    /// A confirmed `remove_project` likewise signals the UI; a no-op (needs
    /// confirmation) must NOT, since nothing changed.
    #[test]
    fn remove_project_tool_signals_only_on_actual_removal() {
        let registry = SessionRegistry::default();
        let sink: Arc<RecordingSink> = Arc::new(RecordingSink::default());
        let store_dir = TempDir::new("rm-signal-store");
        let store: Arc<TempStore> = Arc::new(TempStore::new(store_dir.path.clone()));

        // One managed dir with a live session so an unconfirmed remove is a no-op.
        let target = TempDir::new("rm-signal-dir");
        let managed = vec![dir(&target.path_str(), "rm-signal-dir", Some("main"))];
        let dirs: Arc<dyn DirectorySource> = Arc::new(FixedDirs(managed.clone()));
        let server = MechsuitServer::new(
            registry.clone(),
            dirs,
            store.clone() as Arc<dyn DirectoryStore>,
            sink.clone(),
        );
        let session = spawn_session(&registry, &target.path_str());

        // No confirm + live session → needs confirmation → no signal.
        server
            .remove_project(Parameters(RemoveProjectParams {
                query: "rm-signal-dir".to_string(),
                confirm: false,
            }))
            .expect("remove_project ok");
        assert_eq!(
            *sink.1.lock().unwrap(),
            0,
            "an unconfirmed (no-op) remove must not signal"
        );

        // Confirmed → kills + removes → signals once.
        server
            .remove_project(Parameters(RemoveProjectParams {
                query: "rm-signal-dir".to_string(),
                confirm: true,
            }))
            .expect("remove_project ok");
        assert_eq!(
            *sink.1.lock().unwrap(),
            1,
            "a confirmed removal emits directories_changed"
        );
        assert!(!registry.contains(&session), "session killed on confirm");
    }
}
