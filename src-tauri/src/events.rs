//! Event-name constants and payload structs emitted to the frontend.
//!
//! Payload field names are serialized in camelCase to match the TypeScript
//! mirror (`ts-ipc-contract`).

use serde::{Deserialize, Serialize};

/// Emitted with a chunk of session stdout/stderr output.
pub const SESSION_OUTPUT: &str = "session://output";

/// Emitted when a session's PTY process exits.
pub const SESSION_EXIT: &str = "session://exit";

/// Emitted when the Commander's `resolve_project` MCP tool matches a managed
/// directory: the UI should select that directory. Payload is the directory
/// path as a bare JSON string. The frontend (`commander-app-wiring`) listens on
/// this exact name.
pub const COMMANDER_NAVIGATE: &str = "commander://navigate";

/// Emitted when a Commander MCP tool mutates the managed directory list
/// (`add_project` / `remove_project`): the sidebar should reload it via
/// `list_directories`. Without this, a Commander-driven add/remove only lands
/// in the persisted store and the frontend's once-loaded list stays stale until
/// the next mount. Payload is empty (unit). The frontend listens on this name.
pub const COMMANDER_DIRECTORIES_CHANGED: &str = "commander://directories-changed";

/// Payload for [`SESSION_OUTPUT`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputEvent {
    pub session_id: String,
    pub data: String,
}

/// Payload for [`SESSION_EXIT`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitEvent {
    pub session_id: String,
    pub code: Option<i32>,
}
