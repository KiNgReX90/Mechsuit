//! Commander Claude driver.
//!
//! Commander is a **long-lived interactive `claude` terminal** that reuses the
//! user's existing login (subscription OAuth, *no* API key) and reaches mechsuit
//! through the in-process MCP server ([`crate::mcp`]). This module owns spawning
//! that session (via [`spawn_commander_session`]) and tracking the single live
//! Commander instance so spawning is idempotent.
//!
//! Auth: we **remove** `ANTHROPIC_API_KEY` from the child env and never pass
//! `--bare`, so `claude` falls back to the stored subscription OAuth. mechsuit
//! itself holds no key (guarded by the item's `finalize_check`).
//!
//! Wiring: `claude` is spawned with `--mcp-config` pointing at the running MCP
//! server (`http://{addr}/mcp`, transport `http`) plus `--strict-mcp-config` so
//! only mechsuit's tools are visible, `--allowedTools "mcp__mechsuit__*"` and
//! `--permission-mode bypassPermissions` for a non-interactive run, and the
//! concise persona via `--append-system-prompt`.
//!
//! This is one long-lived interactive process — no `--print`, `--output-format`,
//! or `--resume` (those forced the old headless one-shot mode).

use std::sync::Mutex;

use crate::mcp::{McpServerAddr, MCP_PATH};
use crate::models::{SessionInfo, SessionKind};
use crate::pty::SessionRegistry;

/// The `claude` executable name (resolved via `PATH`).
const CLAUDE_BIN: &str = "claude";

/// Working directory the interactive `claude` is spawned in: the user's home, so
/// its reach spans everything the user points it at (with `~/dev` as the
/// default discovery root for `discover_projects`).
const SPAWN_CWD: &str = "/home/ruben";

/// Concise Commander persona, appended to `claude`'s default system prompt.
///
/// Kept terse on purpose: Commander answers yes/no when it can, uses the fewest
/// words, and only elaborates when explicitly asked. Status reads go through the
/// passive `read_session_output` tool; `send_to_session` is reserved for when the
/// user explicitly asks to "ask" a session.
const PERSONA: &str = "\
You are Commander, a terse supervisor of coding-agent terminal sessions inside mechsuit. \
Answer yes/no when possible. Use the fewest words. Do not explain unless explicitly asked; \
when asked to elaborate, reply in at most ~10 sentences using markdown. \
For a session's state use snapshot_session: it returns the RENDERED screen plus status \
(working/awaiting-approval/idle/error), title, model, tokenCount, and lastAssistantMessage — \
read this, do NOT inject input. read_session_output is the raw-scrollback fallback. \
To ASK or brainstorm with a session, use ask_session (it submits and waits for the reply); \
when its settled is awaiting-approval, relay that to the user instead of waiting. \
send_to_session is fire-and-forget keystrokes — use it only when told to \"just type this\". \
To inspect a run's progress (e.g. INFERNO), read its on-disk artifacts with read_file \
(.specs-inferno/state.yaml, work items, briefs), list_dir, and grep_files — read-only and \
scoped to the project. \
You also manage the workspace itself. discover_projects (default root ~/dev) finds candidate \
repos/dirs and add_project adds one — both are direct, non-destructive; do them without asking. \
remove_project is destructive: ALWAYS get explicit user confirmation first. When it returns \
confirmationRequired with activeSessions > 0, warn the user that removing will kill that many live \
sessions and ask them to confirm; only after they agree, re-call remove_project with confirm: true. \
You can also pause and resume a workspace's running agents: pause_sessions (queries \
and/or all:true) OS-suspends them in place — reversible and non-destructive, so do it \
directly when asked; resume_sessions continues them.";

/// Build the MCP config JSON string passed to `--mcp-config`.
///
/// Points a single server named `mechsuit` at the in-process streamable-HTTP
/// endpoint. The `mcp__mechsuit__*` allow-list and tool names key off this name.
fn mcp_config_json(mcp_url: &str) -> String {
    // Hand-built (rather than serde_json::json!) so the exact shape is obvious
    // and stable for the argv assertion test.
    format!(
        r#"{{"mcpServers":{{"mechsuit":{{"type":"http","url":"{mcp_url}"}}}}}}"#,
        mcp_url = mcp_url
    )
}

/// Build the MCP endpoint URL from the managed bound address.
fn mcp_url(addr: &McpServerAddr) -> String {
    format!("http://{}{MCP_PATH}", addr.0)
}

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
            persona.contains("Commander")
                && persona.contains("snapshot_session")
                && persona.contains("ask_session"),
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
