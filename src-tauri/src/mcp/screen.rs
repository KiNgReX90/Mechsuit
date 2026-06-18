//! Pure terminal-screen heuristics for the Commander observability tools.
//!
//! A faithful Rust port of the frontend `statusParser` (approval/error prompt
//! detection) plus best-effort extractors for the structured fields
//! `snapshot_session` surfaces (title, model, token/context count, last
//! assistant message). Every function here is pure and operates on the
//! ALREADY-RENDERED screen text — vt100 has applied escape codes — so no ANSI
//! stripping is needed.
//!
//! The structured extractors are deliberately BEST-EFFORT and tied to Claude
//! Code's current TUI; when one misses it returns `None`, and the caller always
//! includes the raw rendered `screen` as the fallback. Keep the regex set small
//! and well-commented — this is the primary place agent prompt styles get added.

use std::sync::OnceLock;
use std::time::Duration;

use regex::Regex;
use serde::Serialize;

use crate::pty::ScreenSnapshot;

/// Quiet window after which a session with no further output is classified
/// idle rather than working. Mirrors the frontend `IDLE_DEBOUNCE_MS`.
pub const IDLE_AFTER: Duration = Duration::from_millis(2000);

/// Derived session state. Mirrors the frontend `SessionStatus` vocabulary
/// (`working | awaiting-approval | ready | error`) but exposes `idle` in place
/// of the UI's `ready` for a clearer Commander-facing reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionStatus {
    Working,
    AwaitingApproval,
    Idle,
    Error,
}

/// How an [`ask_session`](crate::mcp) call concluded: the session produced a
/// real answer and went quiet (`idle`), stopped to ask permission
/// (`awaiting-approval`) — relay it, don't keep waiting — or is still grinding
/// when the timeout elapsed (`timeout`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Settled {
    Idle,
    AwaitingApproval,
    Timeout,
}

/// The structured snapshot the `snapshot_session` tool returns. `status`,
/// `awaiting_input`, `cursor_row`, and `screen` are always reliable; `title`
/// falls back to the directory basename; `model` / `token_count` /
/// `last_assistant_message` are best-effort (`None` when not found), with
/// `screen` as the guaranteed fallback.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub status: SessionStatus,
    pub awaiting_input: bool,
    pub title: String,
    pub model: Option<String>,
    pub token_count: Option<u64>,
    pub last_assistant_message: Option<String>,
    pub cursor_row: u16,
    pub screen: String,
}

/// Approval-prompt detectors, matched against the rendered screen. Ordered
/// Claude Code first, then generic confirmation styles. Compiled once.
fn approval_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            // Claude Code numbered choice menus: "❯ 1. Yes" / "1. Yes" (the
            // leading caret and styling are optional/already rendered away).
            Regex::new(r"(?im)^\s*(?:❯\s*)?1\.\s*yes\b").unwrap(),
            // Explicit "Do you want to proceed?" style confirmations.
            Regex::new(r"(?i)\bdo you want to (?:proceed|continue)\b").unwrap(),
            // Generic yes/no confirmations: (y/n), [Y/n], (yes/no).
            Regex::new(r"(?i)[(\[]\s*y(?:es)?\s*/\s*n(?:o)?\s*[)\]]").unwrap(),
        ]
    })
}

/// Error-signature detectors, anchored to line starts where possible so an
/// incidental mid-sentence "error" does not fire. Compiled once.
fn error_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"(?im)^\s*error:").unwrap(),
            Regex::new(r"(?im)^\s*fatal:").unwrap(),
            Regex::new(r"(?i)\bcommand not found\b").unwrap(),
            // Runtime panics: Go's "panic:" and Rust's "...panicked at".
            Regex::new(r"(?i)\bpanic(?:ked)?\b").unwrap(),
            Regex::new(r"Traceback \(most recent call last\)").unwrap(),
        ]
    })
}

/// True when the rendered screen looks like an interactive approval prompt
/// awaiting the user's confirmation. Returns `false` for plain output.
pub fn matches_approval(text: &str) -> bool {
    !text.is_empty() && approval_patterns().iter().any(|re| re.is_match(text))
}

/// True when the rendered screen contains a known error signature.
pub fn matches_error(text: &str) -> bool {
    !text.is_empty() && error_patterns().iter().any(|re| re.is_match(text))
}

/// Classify a session's state from its rendered screen and how long it has been
/// quiet. An on-screen approval prompt is reported even while output is recent
/// (a freshly-printed prompt IS awaiting input); errors win outright.
pub fn classify_status(text: &str, idle_for: Duration) -> SessionStatus {
    if matches_error(text) {
        SessionStatus::Error
    } else if matches_approval(text) {
        SessionStatus::AwaitingApproval
    } else if idle_for < IDLE_AFTER {
        SessionStatus::Working
    } else {
        SessionStatus::Idle
    }
}

/// Decide whether an `ask_session` poll has settled, given the current quiet
/// duration, whether an approval prompt is visible, and the elapsed time
/// against the timeout. Pure so the async poll loop is trivially testable.
/// Returns `None` while still waiting.
pub fn settle_decision(
    idle_for: Duration,
    quiet: Duration,
    approval: bool,
    elapsed: Duration,
    timeout: Duration,
) -> Option<Settled> {
    if approval {
        Some(Settled::AwaitingApproval)
    } else if idle_for >= quiet {
        Some(Settled::Idle)
    } else if elapsed >= timeout {
        Some(Settled::Timeout)
    } else {
        None
    }
}

/// Best-effort model name from Claude Code's UI (e.g. "opus", "sonnet", or a
/// full `claude-...` id). `None` when not present.
pub fn extract_model(text: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)\b(claude-[a-z0-9][a-z0-9.\-]*|opus|sonnet|haiku)\b").unwrap()
    });
    re.find(text).map(|m| m.as_str().to_string())
}

/// Best-effort token/context count from a "<n> tokens" style readout. Strips
/// grouping commas. `None` when not present.
pub fn extract_token_count(text: &str) -> Option<u64> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)([\d,]+)\s*tokens\b").unwrap());
    let caps = re.captures(text)?;
    let digits: String = caps
        .get(1)?
        .as_str()
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Best-effort extraction of the last assistant message. Claude Code renders
/// assistant turns with a leading "⏺" bullet; this returns the final such block
/// (from the last bullet line up to the next blank line), marker stripped.
/// `None` when no bullet is present.
pub fn extract_last_assistant(text: &str) -> Option<String> {
    const MARKER: char = '⏺';
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.iter().rposition(|l| l.trim_start().starts_with(MARKER))?;

    let mut out: Vec<String> = Vec::new();
    for line in &lines[start..] {
        if out.is_empty() {
            let body = line.trim_start();
            let body = body.strip_prefix(MARKER).unwrap_or(body).trim_start();
            out.push(body.trim_end().to_string());
        } else if line.trim().is_empty() {
            break;
        } else {
            out.push(line.trim_end().to_string());
        }
    }
    let joined = out.join("\n").trim().to_string();
    (!joined.is_empty()).then_some(joined)
}

/// The session title: the program's OSC title when set, else the directory
/// basename. Never empty for a real directory.
pub fn pick_title(rendered: &ScreenSnapshot) -> String {
    let title = rendered.title.trim();
    if !title.is_empty() {
        return title.to_string();
    }
    rendered
        .dir_path
        .trim_end_matches('/')
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or(rendered.dir_path.as_str())
        .to_string()
}

/// Assemble the structured [`SessionSnapshot`] from a rendered screen.
pub fn build_snapshot(rendered: &ScreenSnapshot) -> SessionSnapshot {
    let text = &rendered.text;
    SessionSnapshot {
        status: classify_status(text, rendered.idle_for),
        awaiting_input: matches_approval(text),
        title: pick_title(rendered),
        model: extract_model(text),
        token_count: extract_token_count(text),
        last_assistant_message: extract_last_assistant(text),
        cursor_row: rendered.cursor_row,
        screen: text.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_prompts_detected_across_styles() {
        assert!(matches_approval("Some output\n❯ 1. Yes\n  2. No"));
        assert!(matches_approval("1. Yes, proceed\n2. No"));
        assert!(matches_approval("Do you want to proceed?"));
        assert!(matches_approval("Overwrite file? (y/n)"));
        assert!(matches_approval("Continue [Y/n]"));
        // Plain output must not look like a prompt.
        assert!(!matches_approval("Running tests...\nAll good."));
        assert!(!matches_approval(""));
    }

    #[test]
    fn error_signatures_detected_without_false_firing() {
        assert!(matches_error("error: something broke"));
        assert!(matches_error("  fatal: not a git repository"));
        assert!(matches_error("bash: foo: command not found"));
        assert!(matches_error("thread 'main' panicked"));
        assert!(matches_error("Traceback (most recent call last)"));
        // The bare word "error" mid-sentence does not fire.
        assert!(!matches_error("There was no error in the build."));
    }

    #[test]
    fn status_classification_orders_error_approval_then_idle_time() {
        // Error wins even if quiet.
        assert_eq!(
            classify_status("error: boom", Duration::from_secs(10)),
            SessionStatus::Error
        );
        // Approval reported even while output is recent.
        assert_eq!(
            classify_status("Do you want to proceed?", Duration::from_millis(0)),
            SessionStatus::AwaitingApproval
        );
        // Recent output, no prompt → working.
        assert_eq!(
            classify_status("…thinking…", Duration::from_millis(500)),
            SessionStatus::Working
        );
        // Quiet for long enough → idle.
        assert_eq!(
            classify_status("done.", Duration::from_secs(5)),
            SessionStatus::Idle
        );
    }

    #[test]
    fn settle_decision_prefers_approval_then_idle_then_timeout() {
        let quiet = Duration::from_secs(2);
        let timeout = Duration::from_secs(60);
        // Approval short-circuits regardless of timing.
        assert_eq!(
            settle_decision(Duration::ZERO, quiet, true, Duration::ZERO, timeout),
            Some(Settled::AwaitingApproval)
        );
        // Quiet long enough → idle.
        assert_eq!(
            settle_decision(quiet, quiet, false, Duration::from_secs(3), timeout),
            Some(Settled::Idle)
        );
        // Still chatty but past the timeout → timeout.
        assert_eq!(
            settle_decision(Duration::ZERO, quiet, false, timeout, timeout),
            Some(Settled::Timeout)
        );
        // Still chatty and within budget → keep waiting.
        assert_eq!(
            settle_decision(
                Duration::from_millis(100),
                quiet,
                false,
                Duration::from_secs(1),
                timeout
            ),
            None
        );
    }

    #[test]
    fn extracts_best_effort_fields() {
        assert_eq!(extract_model("Model: opus  •  ~/dev"), Some("opus".to_string()));
        assert_eq!(
            extract_model("claude-opus-4-8 ready"),
            Some("claude-opus-4-8".to_string())
        );
        assert_eq!(extract_model("plain shell prompt"), None);

        assert_eq!(extract_token_count("Context: 48,213 tokens used"), Some(48213));
        assert_eq!(extract_token_count("no count here"), None);
    }

    #[test]
    fn last_assistant_message_is_the_final_bullet_block() {
        let screen = "\
⏺ First message
  trailing line

> some user input

⏺ The final answer
  spans two lines

╭─ input box ─╮";
        assert_eq!(
            extract_last_assistant(screen),
            Some("The final answer\n  spans two lines".to_string())
        );
        assert_eq!(extract_last_assistant("no bullets at all"), None);
    }

    #[test]
    fn title_falls_back_to_directory_basename() {
        let rendered = ScreenSnapshot {
            dir_path: "/home/ruben/dev/itris-mechsuit/".to_string(),
            text: String::new(),
            title: String::new(),
            cursor_row: 0,
            idle_for: Duration::ZERO,
        };
        assert_eq!(pick_title(&rendered), "itris-mechsuit");

        let with_title = ScreenSnapshot {
            title: "claude — wi-04".to_string(),
            ..rendered
        };
        assert_eq!(pick_title(&with_title), "claude — wi-04");
    }
}
