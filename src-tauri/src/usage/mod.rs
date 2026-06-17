//! Claude subscription usage meter.
//!
//! Reads the user's Claude subscription usage limits from the undocumented
//! OAuth usage endpoint and exposes them to the frontend. Auth reuses the
//! user's existing subscription login: the OAuth access token stored in
//! `~/.claude/.credentials.json` (the same login the Commander driver leans on,
//! see [`crate::commander`]). mechsuit holds no API key.
//!
//! Structure mirrors [`crate::commander`]: pure, I/O-free helpers
//! ([`parse_access_token`], [`parse_usage`]) carry the testable logic and the
//! thin I/O wrappers ([`read_access_token`], [`fetch_usage`]) layer the file
//! read + network GET on top. The pure parsers have `#[cfg(test)]` unit tests;
//! the credentials read and the network GET are deliberately *not* unit-tested
//! (no test touches the real network or the real credentials file).
//!
//! Privacy: the access token and the full `Authorization` header are never
//! logged.

use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::State;

/// Usage endpoint (undocumented OAuth surface). Returns the subscription's
/// rolling-window utilization.
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

/// OAuth beta header value required by the usage endpoint.
const OAUTH_BETA: &str = "oauth-2025-04-20";

/// One usage window's utilization and reset time.
///
/// Serializes camelCase (`utilization`, `resetsAt`) for the IPC payload, while
/// `resets_at` also reads the endpoint's snake_case `resets_at` on the way in
/// (see [`parse_usage`]). The RFC3339 `resets_at` string is passed through
/// verbatim — no date parsing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// Fraction (or percentage, per the endpoint) of the window consumed.
    pub utilization: f64,
    /// RFC3339 timestamp at which this window resets, verbatim from the
    /// endpoint. Reads the endpoint's `resets_at`; serializes as `resetsAt`.
    #[serde(alias = "resets_at")]
    pub resets_at: String,
}

/// A subscription usage snapshot: the five-hour and seven-day rolling windows.
///
/// Serializes camelCase (`fiveHour`, `sevenDay`) for the IPC payload, while
/// each field also reads the endpoint's snake_case key (`five_hour` /
/// `seven_day`) on the way in (see [`parse_usage`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    /// The rolling five-hour window.
    #[serde(alias = "five_hour")]
    pub five_hour: UsageWindow,
    /// The rolling seven-day window.
    #[serde(alias = "seven_day")]
    pub seven_day: UsageWindow,
}

/// Process-lifetime cache of the most recent successful usage snapshot.
///
/// The background poller writes it on every successful fetch; [`get_usage`]
/// (the frontend's mount-time prime) reads it instead of issuing its own
/// network request. This (a) avoids a duplicate request on every boot — which
/// matters against the endpoint's rate limit — and (b) hands the frontend the
/// poller's already-fetched data even if the webview subscribed to
/// `usage://updated` too late to catch the poller's first emit. A poisoned lock
/// degrades to "no cached value" rather than panicking.
#[derive(Clone, Default)]
pub struct UsageCache(Arc<Mutex<Option<UsageSnapshot>>>);

impl UsageCache {
    /// The last cached snapshot, or `None` if none has been stored yet.
    pub fn get(&self) -> Option<UsageSnapshot> {
        self.0.lock().ok().and_then(|guard| guard.clone())
    }

    /// Replace the cached snapshot with the latest successful fetch.
    pub fn set(&self, snapshot: UsageSnapshot) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(snapshot);
        }
    }
}

/// Extract `claudeAiOauth.accessToken` from the contents of
/// `~/.claude/.credentials.json`.
///
/// Pure and testable: no I/O. A clear `Err(String)` for malformed JSON or a
/// missing `claudeAiOauth.accessToken` field. The returned token is never
/// logged by callers.
pub fn parse_access_token(file_contents: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(file_contents)
        .map_err(|e| format!("failed to parse credentials JSON: {e}"))?;

    value
        .get("claudeAiOauth")
        .and_then(|v| v.get("accessToken"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "credentials JSON missing claudeAiOauth.accessToken".to_string())
}

/// Map the usage endpoint body into a [`UsageSnapshot`].
///
/// Pure and testable: no I/O. The incoming body uses snake_case
/// (`five_hour`/`seven_day`/`resets_at`); the structs read it via serde
/// aliases. Malformed JSON or a missing window/field is a clear `Err(String)`.
/// The `resets_at` RFC3339 string is passed through verbatim.
pub fn parse_usage(body: &str) -> Result<UsageSnapshot, String> {
    serde_json::from_str(body).map_err(|e| format!("failed to parse usage body: {e}"))
}

/// Resolve `~/.claude/.credentials.json` from `$HOME`, read it **fresh on each
/// call** (never cached in memory), and extract the access token via
/// [`parse_access_token`].
///
/// `$HOME` is read from the environment — never hard-coded. Any failure
/// (missing `$HOME`, unreadable file, malformed JSON, absent token) is a clear
/// `Err(String)`; the token is never logged.
fn read_access_token() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let path = format!("{home}/.claude/.credentials.json");
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read credentials file: {e}"))?;
    parse_access_token(&contents)
}

/// Fallback User-Agent version when the installed `claude` CLI version cannot
/// be resolved. Any `claude-code/<version>` reaches the normal request bucket;
/// the exact number is not validated by the endpoint.
const FALLBACK_UA_VERSION: &str = "2.1.0";

/// Extract the first `major.minor.patch` token from `claude --version` output.
///
/// Pure and testable. Tolerates a leading `v` and a pre-release suffix
/// (e.g. `v2.0.10-beta` -> `2.0.10`); returns `None` when no three-part semver
/// is present.
fn parse_claude_version(output: &str) -> Option<String> {
    output.split_whitespace().find_map(|token| {
        // Strip anything that isn't a digit or dot from both ends (the leading
        // `v`, a trailing `-beta`, surrounding parens, etc.).
        let core = token.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
        let parts: Vec<&str> = core.split('.').collect();
        let is_semver = parts.len() == 3
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
        is_semver.then(|| core.to_string())
    })
}

/// The `User-Agent` sent to the usage endpoint, resolved once per process.
///
/// The endpoint **requires** a `claude-code/<version>` User-Agent: without it,
/// requests land in an aggressively rate-limited bucket that returns persistent
/// 429s (confirmed empirically and in the Claude Code issue tracker). We mirror
/// the installed `claude` CLI's version when readable, else fall back to a
/// constant.
fn usage_user_agent() -> &'static str {
    static UA: OnceLock<String> = OnceLock::new();
    UA.get_or_init(|| {
        let version = Command::new("claude")
            .arg("--version")
            .output()
            .ok()
            .filter(|out| out.status.success())
            .and_then(|out| parse_claude_version(&String::from_utf8_lossy(&out.stdout)))
            .unwrap_or_else(|| FALLBACK_UA_VERSION.to_string());
        format!("claude-code/{version}")
    })
}

/// `GET` the usage endpoint with the OAuth bearer token + beta header and parse
/// the body into a [`UsageSnapshot`].
///
/// Reqwest runs on the existing tokio runtime. A non-200 status, network error,
/// or unparsable body is a clear `Err(String)`. Neither the token nor the full
/// `Authorization` header is ever logged.
async fn fetch_usage(token: &str) -> Result<UsageSnapshot, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(USAGE_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("anthropic-beta", OAUTH_BETA)
        // Required: without a claude-code User-Agent the endpoint throttles hard
        // (persistent 429s). See [`usage_user_agent`].
        .header("User-Agent", usage_user_agent())
        .send()
        .await
        .map_err(|e| format!("usage request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("usage endpoint returned status {status}"));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("failed to read usage response body: {e}"))?;

    parse_usage(&body)
}

/// Read the token fresh, fetch the usage snapshot, and parse it.
///
/// The single entry point shared by the [`get_usage`] command and the
/// background poller (see [`crate::run`]'s setup). Any failure — missing or
/// expired token, non-200, network error, bad JSON — is a clear `Err(String)`,
/// never a panic. The token is never logged.
pub async fn fetch_snapshot() -> Result<UsageSnapshot, String> {
    let token = read_access_token()?;
    fetch_usage(&token).await
}

/// Read the current Claude subscription usage snapshot for the frontend's
/// mount-time prime.
///
/// Serves the background poller's cached snapshot when one exists — no second
/// network request, and the frontend gets data even if it missed the poller's
/// first `usage://updated` emit. Only on a cold cache (very early boot, before
/// the poller's first fetch lands) does it fetch once and warm the cache. Any
/// I/O, network, or parse failure is a clear `Err(String)` — never a panic.
#[tauri::command]
pub async fn get_usage(cache: State<'_, UsageCache>) -> Result<UsageSnapshot, String> {
    if let Some(snapshot) = cache.get() {
        return Ok(snapshot);
    }
    let snapshot = fetch_snapshot().await?;
    cache.set(snapshot.clone());
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cache starts empty and returns whatever was last stored.
    #[test]
    fn usage_cache_starts_empty_then_returns_last_set() {
        let cache = UsageCache::default();
        assert!(cache.get().is_none(), "fresh cache has no snapshot");

        let snap = UsageSnapshot {
            five_hour: UsageWindow {
                utilization: 21.0,
                resets_at: "2026-06-17T07:00:00Z".to_string(),
            },
            seven_day: UsageWindow {
                utilization: 38.0,
                resets_at: "2026-06-22T20:00:00Z".to_string(),
            },
        };
        cache.set(snap);

        let got = cache.get().expect("cache returns the stored snapshot");
        assert_eq!(got.five_hour.utilization, 21.0);
        assert_eq!(got.seven_day.utilization, 38.0);
    }

    /// The `claude --version` output is mined for the first semver token, used
    /// to build the required `claude-code/<version>` User-Agent.
    #[test]
    fn parse_claude_version_extracts_first_semver() {
        assert_eq!(
            parse_claude_version("2.1.179 (Claude Code)").as_deref(),
            Some("2.1.179")
        );
        assert_eq!(parse_claude_version("claude 1.2.3").as_deref(), Some("1.2.3"));
        // Tolerates a leading `v` and a pre-release suffix.
        assert_eq!(parse_claude_version("v2.0.10-beta").as_deref(), Some("2.0.10"));
        // No semver present.
        assert_eq!(parse_claude_version("unknown").as_deref(), None);
        assert_eq!(parse_claude_version("").as_deref(), None);
        // A two-part version is not accepted (needs major.minor.patch).
        assert_eq!(parse_claude_version("1.2").as_deref(), None);
    }

    /// A valid credentials blob yields the nested access token.
    #[test]
    fn parse_access_token_extracts_nested_token() {
        let creds = r#"{
            "claudeAiOauth": {
                "accessToken": "tok-abc123",
                "refreshToken": "ref-xyz",
                "expiresAt": 1234567890
            }
        }"#;
        assert_eq!(parse_access_token(creds).unwrap(), "tok-abc123");
    }

    /// A missing `claudeAiOauth.accessToken` (absent field or absent parent)
    /// errors cleanly rather than panicking.
    #[test]
    fn parse_access_token_errors_on_missing_field() {
        // Parent present, token absent.
        assert!(parse_access_token(r#"{"claudeAiOauth":{"refreshToken":"r"}}"#).is_err());
        // Parent absent entirely.
        assert!(parse_access_token(r#"{"other":1}"#).is_err());
        // accessToken present but not a string.
        assert!(parse_access_token(r#"{"claudeAiOauth":{"accessToken":42}}"#).is_err());
    }

    /// Malformed JSON errors cleanly.
    #[test]
    fn parse_access_token_errors_on_malformed_json() {
        assert!(parse_access_token("not json").is_err());
        assert!(parse_access_token("").is_err());
    }

    /// A valid body maps both windows; the snake_case input is read and
    /// `resets_at` passes through verbatim.
    #[test]
    fn parse_usage_maps_both_windows() {
        let body = r#"{
            "five_hour": { "utilization": 0.25, "resets_at": "2026-06-16T18:00:00Z" },
            "seven_day": { "utilization": 0.5, "resets_at": "2026-06-22T00:00:00Z" }
        }"#;
        let snap = parse_usage(body).expect("valid body parses");
        assert_eq!(snap.five_hour.utilization, 0.25);
        assert_eq!(snap.five_hour.resets_at, "2026-06-16T18:00:00Z");
        assert_eq!(snap.seven_day.utilization, 0.5);
        assert_eq!(snap.seven_day.resets_at, "2026-06-22T00:00:00Z");
    }

    /// A missing window or a missing field within a window errors cleanly.
    #[test]
    fn parse_usage_errors_on_missing_field() {
        // Missing the entire seven_day window.
        let missing_window = r#"{
            "five_hour": { "utilization": 0.25, "resets_at": "2026-06-16T18:00:00Z" }
        }"#;
        assert!(parse_usage(missing_window).is_err());

        // Window present but missing resets_at.
        let missing_field = r#"{
            "five_hour": { "utilization": 0.25 },
            "seven_day": { "utilization": 0.5, "resets_at": "2026-06-22T00:00:00Z" }
        }"#;
        assert!(parse_usage(missing_field).is_err());
    }

    /// Malformed JSON errors cleanly.
    #[test]
    fn parse_usage_errors_on_malformed_json() {
        assert!(parse_usage("not json").is_err());
        assert!(parse_usage("").is_err());
    }

    /// The IPC payload serializes camelCase: `fiveHour`, `sevenDay`,
    /// `utilization`, `resetsAt`.
    #[test]
    fn usage_snapshot_serializes_camel_case() {
        let snap = UsageSnapshot {
            five_hour: UsageWindow {
                utilization: 0.1,
                resets_at: "2026-06-16T18:00:00Z".to_string(),
            },
            seven_day: UsageWindow {
                utilization: 0.2,
                resets_at: "2026-06-22T00:00:00Z".to_string(),
            },
        };
        let json = serde_json::to_string(&snap).unwrap();
        assert!(json.contains("\"fiveHour\""), "got: {json}");
        assert!(json.contains("\"sevenDay\""), "got: {json}");
        assert!(json.contains("\"resetsAt\""), "got: {json}");
        assert!(json.contains("\"utilization\""), "got: {json}");
        // Snake_case keys must NOT appear in the outgoing payload.
        assert!(!json.contains("five_hour"), "got: {json}");
        assert!(!json.contains("resets_at"), "got: {json}");
    }
}
