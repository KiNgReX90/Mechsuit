//! Commander Claude driver.
//!
//! Commander is a **headless `claude` process** that reuses the user's existing
//! login (subscription OAuth, *no* API key) and reaches mechsuit through the
//! in-process MCP server ([`crate::mcp`]). This module owns spawning that
//! process and turning its JSON output into a `{ reply, sessionId }` result.
//!
//! Auth: we **remove** `ANTHROPIC_API_KEY` from the child env and never pass
//! `--bare`, so `claude` falls back to the stored subscription OAuth. mechsuit
//! itself holds no key (guarded by the item's `finalize_check`).
//!
//! Wiring: `claude` is spawned with `--mcp-config` pointing at the running MCP
//! server (`http://{addr}/mcp`, transport `http`) plus `--strict-mcp-config` so
//! only mechsuit's tools are visible, `--allowedTools "mcp__mechsuit__*"` and
//! `--permission-mode bypassPermissions` for a non-interactive run, the concise
//! persona via `--append-system-prompt`, and `--output-format json` so we can
//! parse the reply text + `session_id`.
//!
//! Multi-turn: the first turn returns a `session_id`; passing it back issues
//! `--resume <id>` so the overlay can keep one conversation going.
//!
//! The argv is built by the pure [`build_args`] helper so the Rust test can
//! assert the command line without spawning a real `claude`.

use std::process::Command;

use tauri::State;

use crate::mcp::{McpServerAddr, MCP_PATH};

/// The `claude` executable name (resolved via `PATH`).
const CLAUDE_BIN: &str = "claude";

/// Working directory the headless `claude` is spawned in: the user's home, so
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
For passive status, read a session's output with the read_session_output tool — do NOT inject input. \
Only use send_to_session when the user explicitly asks you to \"ask\" a session something; \
after sending, re-read the session's output until its reply settles, then report it. \
You also manage the workspace itself. discover_projects (default root ~/dev) finds candidate \
repos/dirs and add_project adds one — both are direct, non-destructive; do them without asking. \
remove_project is destructive: ALWAYS get explicit user confirmation first. When it returns \
confirmationRequired with activeSessions > 0, warn the user that removing will kill that many live \
sessions and ask them to confirm; only after they agree, re-call remove_project with confirm: true.";

/// Result of one Commander turn: the reply text and the conversation's
/// `session_id` (pass it back on the next turn to continue the conversation).
///
/// Serialized camelCase to match the TS `CommanderMessage` / IPC conventions.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommanderReply {
    /// The assistant's reply text for this turn.
    pub reply: String,
    /// The conversation id to resume on the next turn.
    pub session_id: String,
}

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

/// Build the full `claude` argument vector for one Commander turn.
///
/// Pure and testable: no process spawn, no env access. `mcp_url` is the MCP
/// endpoint URL (`http://{addr}/mcp`); `session_id` is `Some(id)` on a
/// continuing turn (adds `--resume <id>`) and `None` on the first turn.
///
/// Note the env (`ANTHROPIC_API_KEY` removal) is applied by the caller on the
/// `Command`, not here — this builder only produces the argv.
pub fn build_args(message: &str, mcp_url: &str, session_id: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec![
        // Non-interactive single-turn print mode.
        "--print".to_string(),
        // Capture reply text + session_id as structured JSON.
        "--output-format".to_string(),
        "json".to_string(),
        // Wire mechsuit's in-process MCP server; restrict to it only.
        "--mcp-config".to_string(),
        mcp_config_json(mcp_url),
        "--strict-mcp-config".to_string(),
        // Pre-allow mechsuit's tools and run without interactive permission
        // prompts (headless).
        "--allowedTools".to_string(),
        "mcp__mechsuit__*".to_string(),
        "--permission-mode".to_string(),
        "bypassPermissions".to_string(),
        // Concise Commander persona.
        "--append-system-prompt".to_string(),
        PERSONA.to_string(),
    ];

    // Continue an existing conversation when a session id is carried over.
    if let Some(id) = session_id {
        args.push("--resume".to_string());
        args.push(id.to_string());
    }

    // The prompt is the trailing positional argument.
    args.push(message.to_string());

    args
}

/// Parse `claude --output-format json` stdout into a [`CommanderReply`].
///
/// The JSON envelope carries the assistant reply under `result` and the
/// conversation id under `session_id`. Anything else (missing fields, invalid
/// JSON) is a clear `Err(String)`.
fn parse_reply(stdout: &str) -> Result<CommanderReply, String> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("failed to parse claude JSON output: {e}"))?;

    let reply = value
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "claude JSON output missing string `result`".to_string())?
        .to_string();

    let session_id = value
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "claude JSON output missing string `session_id`".to_string())?
        .to_string();

    Ok(CommanderReply { reply, session_id })
}

/// Run one Commander turn: spawn headless `claude`, parse its JSON reply.
///
/// `mcp_url` is the in-process MCP endpoint; `session_id` continues an existing
/// conversation when present. Subscription auth is forced by removing
/// `ANTHROPIC_API_KEY` from the child env (and never passing `--bare`).
///
/// Any spawn failure, non-zero exit, or unparsable output becomes an
/// `Err(String)` for the UI to surface.
fn run_turn(
    message: &str,
    mcp_url: &str,
    session_id: Option<&str>,
) -> Result<CommanderReply, String> {
    let args = build_args(message, mcp_url, session_id);

    let output = Command::new(CLAUDE_BIN)
        // Reuse stored subscription OAuth: no key in mechsuit's env reaches the
        // child. (No `--bare`, so OAuth/keychain are read normally.)
        .env_remove("ANTHROPIC_API_KEY")
        // Root the child at the user's home so its reach spans everything the
        // user points it at; `~/dev` is the default discovery root.
        .current_dir(SPAWN_CWD)
        .args(&args)
        .output()
        .map_err(|e| format!("failed to spawn `{CLAUDE_BIN}`: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".to_string());
        return Err(format!(
            "claude exited with status {code}: {}",
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_reply(&stdout)
}

/// Build the MCP endpoint URL from the managed bound address.
fn mcp_url(addr: &McpServerAddr) -> String {
    format!("http://{}{MCP_PATH}", addr.0)
}

/// Send a message to Commander and return its reply + conversation id.
///
/// First turn: pass `session_id = None`; subsequent turns: pass the
/// previously-returned `sessionId` to continue the same conversation.
///
/// **Async + off-thread on purpose.** [`run_turn`] spawns `claude` and *blocks*
/// (`Command::output()`) until it exits — seconds for a plain turn, much longer
/// for a tool-using one (e.g. "add this directory", which round-trips through
/// the MCP server). A synchronous Tauri command runs on the **main thread**, so
/// that block froze the entire window/webview for the whole turn. We make the
/// command `async` and push the blocking work onto a dedicated blocking thread
/// via [`tauri::async_runtime::spawn_blocking`], so the UI stays responsive and
/// async worker threads are never tied up while `claude` runs.
#[tauri::command]
pub async fn commander_send(
    message: String,
    session_id: Option<String>,
    mcp_addr: State<'_, McpServerAddr>,
) -> Result<CommanderReply, String> {
    // Derive the URL *before* the await: `State` is not `Send` across an await
    // point, but the owned `String` it yields is.
    let url = mcp_url(&mcp_addr);
    tauri::async_runtime::spawn_blocking(move || {
        run_turn(&message, &url, session_id.as_deref())
    })
    .await
    .map_err(|e| format!("commander task failed to join: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "http://127.0.0.1:54321/mcp";

    /// First turn: argv carries print/json, the MCP config + strict flag, the
    /// pre-allowed mechsuit tools + bypass permission mode, the persona, and the
    /// prompt as the trailing positional. No `--bare`, no `--resume`.
    #[test]
    fn build_args_first_turn_has_expected_flags() {
        let args = build_args("status?", URL, None);

        // Headless print + structured output.
        assert!(args.contains(&"--print".to_string()));
        assert_flag_value(&args, "--output-format", "json");

        // MCP wiring: config string points at the mechsuit server, restricted.
        let cfg = flag_value(&args, "--mcp-config");
        assert!(
            cfg.contains(r#""mechsuit""#) && cfg.contains(r#""type":"http""#) && cfg.contains(URL),
            "mcp-config must name the mechsuit http server at the url, got: {cfg}"
        );
        assert!(args.contains(&"--strict-mcp-config".to_string()));

        // Tools pre-allowed, non-interactive permission mode.
        assert_flag_value(&args, "--allowedTools", "mcp__mechsuit__*");
        assert_flag_value(&args, "--permission-mode", "bypassPermissions");

        // Persona present.
        let persona = flag_value(&args, "--append-system-prompt");
        assert!(
            persona.contains("Commander") && persona.contains("read_session_output"),
            "append-system-prompt must carry the persona, got: {persona}"
        );

        // Workspace-management persona: discover/add are direct; remove requires
        // explicit confirmation and relays the confirmationRequired/activeSessions
        // protocol before re-calling with confirm: true.
        assert!(
            persona.contains("discover_projects")
                && persona.contains("add_project")
                && persona.contains("remove_project"),
            "persona must mention the three workspace tools, got: {persona}"
        );
        assert!(
            persona.contains("confirmationRequired")
                && persona.contains("activeSessions")
                && persona.contains("confirm: true"),
            "persona must drive the remove confirmation protocol, got: {persona}"
        );

        // No `--bare` (would force API-key auth), no resume on the first turn.
        assert!(!args.contains(&"--bare".to_string()));
        assert!(!args.contains(&"--resume".to_string()));

        // Prompt is the trailing positional argument.
        assert_eq!(args.last().map(String::as_str), Some("status?"));
    }

    /// Continuing turn: `--resume <id>` is present and the prompt stays trailing.
    #[test]
    fn build_args_resume_turn_carries_session_id() {
        let args = build_args("and now?", URL, Some("sess-abc"));
        assert_flag_value(&args, "--resume", "sess-abc");
        assert_eq!(args.last().map(String::as_str), Some("and now?"));
        // Still no bare.
        assert!(!args.contains(&"--bare".to_string()));
    }

    /// The headless `claude` is rooted at the user's home so its reach spans
    /// everything (with `~/dev` as the default discovery root).
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

    /// Reply parsing pulls `result` + `session_id`; missing fields error.
    #[test]
    fn parse_reply_extracts_fields_and_errors_on_missing() {
        let ok = r#"{"type":"result","result":"yes","session_id":"sess-1","other":1}"#;
        let parsed = parse_reply(ok).expect("valid envelope parses");
        assert_eq!(parsed.reply, "yes");
        assert_eq!(parsed.session_id, "sess-1");

        assert!(parse_reply(r#"{"result":"x"}"#).is_err(), "missing session_id");
        assert!(parse_reply(r#"{"session_id":"x"}"#).is_err(), "missing result");
        assert!(parse_reply("not json").is_err(), "invalid json");
    }

    // ---- helpers ----

    /// The value following `flag` in the argv (panics if the flag is absent or
    /// has no following value).
    fn flag_value(args: &[String], flag: &str) -> String {
        let i = args
            .iter()
            .position(|a| a == flag)
            .unwrap_or_else(|| panic!("flag {flag} not found in {args:?}"));
        args.get(i + 1)
            .cloned()
            .unwrap_or_else(|| panic!("flag {flag} has no value in {args:?}"))
    }

    fn assert_flag_value(args: &[String], flag: &str, expected: &str) {
        assert_eq!(flag_value(args, flag), expected, "flag {flag} value");
    }
}
