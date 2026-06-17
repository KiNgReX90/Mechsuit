//! Tauri entry point and IPC contract owner.
//!
//! This file is the single owner of the command/event surface: it declares the
//! backend modules, registers the managed `SessionRegistry`, and wires every
//! command into the Tauri handler. The backend-fill items (`directory-backend`,
//! `pty-backend`) implement behavior inside the modules and never touch this file.

mod commander;
mod directory;
mod events;
mod mcp;
mod models;
mod pty;
mod settings;
mod usage;

use std::time::Duration;

use events::{UsageUpdate, USAGE_UPDATED};
use pty::SessionRegistry;
use tauri::{Emitter, Manager};

/// Cadence of the background usage poller, in seconds. The first poll fires
/// immediately on startup; subsequent *successful* polls wait this long between
/// refreshes. The OAuth usage endpoint throttles aggressively, so we poll
/// conservatively — ~3 minutes is ample for a meter whose 5h/weekly windows
/// move slowly, and the reset countdown is computed client-side between polls.
const POLL_INTERVAL_SECS: u64 = 180;

/// First retry delay after a failed usage poll, in seconds. Failures back off
/// exponentially from here (doubling each consecutive failure) up to
/// `RETRY_MAX_SECS`, so a transient boot blip recovers in seconds instead of
/// waiting the full steady interval.
const RETRY_BASE_SECS: u64 = 5;

/// Cap on the exponential retry backoff, in seconds. Matched to the steady
/// interval so a persistently failing poll never hits the endpoint more often
/// than a healthy one.
const RETRY_MAX_SECS: u64 = 180;

/// Decide the next poll delay and backoff from the last poll's outcome.
///
/// Pure (no clock, no I/O) so it is unit-testable. On success: wait the steady
/// `POLL_INTERVAL_SECS` and reset the backoff to `RETRY_BASE_SECS`. On failure:
/// wait the current backoff now, and double it (capped at `RETRY_MAX_SECS`) for
/// next time. Returns `(delay_secs, next_backoff_secs)`.
fn next_poll_delay(ok: bool, current_backoff: u64) -> (u64, u64) {
    if ok {
        (POLL_INTERVAL_SECS, RETRY_BASE_SECS)
    } else {
        let next = current_backoff.saturating_mul(2).min(RETRY_MAX_SECS);
        (current_backoff, next)
    }
}

pub fn run() {
    // One registry instance shared by the Tauri commands (managed state) and
    // the in-process MCP server (Commander); both must see the same sessions.
    let registry = SessionRegistry::default();

    tauri::Builder::default()
        .manage(registry.clone())
        .manage(commander::CommanderSession::default())
        .setup(move |app| {
            // Start the localhost-only MCP server with the shared registry +
            // the AppHandle (for resolve_project's commander://navigate emit and
            // the live directory list). The bound address is held for the
            // Commander driver's --mcp-config.
            match mcp::start(registry.clone(), app.handle().clone()) {
                Ok(addr) => {
                    app.manage(mcp::McpServerAddr(addr));
                }
                Err(e) => eprintln!("failed to start MCP server: {e}"),
            }

            // Maximize on startup. The `maximized` flag in tauri.conf.json is
            // unreliable on Linux/GTK — it can be evaluated before the window is
            // realized, leaving the borderless window at its default size with its
            // left edge tucked under the desktop dock/panel. Maximizing here, once
            // the window exists, hands the request to the compositor, which sizes
            // the window to the work area: it fills the screen while leaving the
            // dock and top bar visible.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
            }

            // Background usage poller: capture the AppHandle (the emit target,
            // same pattern as mcp::start), fetch the Claude subscription usage
            // snapshot immediately on startup, then refresh every
            // POLL_INTERVAL_SECS. Each refresh emits USAGE_UPDATED carrying the
            // snapshot on success or the error string on failure.
            // Shared usage cache: the poller writes it, the `get_usage` prime
            // reads it (so the frontend never makes a duplicate request and
            // never loses a snapshot to a missed first emit).
            let usage_cache = usage::UsageCache::default();
            app.manage(usage_cache.clone());

            let usage_handle = app.handle().clone();
            let poller_cache = usage_cache.clone();
            tauri::async_runtime::spawn(async move {
                let mut backoff = RETRY_BASE_SECS;
                loop {
                    let (update, ok) = match usage::fetch_snapshot().await {
                        Ok(snapshot) => {
                            poller_cache.set(snapshot.clone());
                            (
                                UsageUpdate {
                                    snapshot: Some(snapshot),
                                    error: None,
                                },
                                true,
                            )
                        }
                        Err(error) => {
                            // Quiet on success; record failures so an offline /
                            // expired-token / rate-limited spell is diagnosable
                            // from the log.
                            eprintln!("[usage] poll failed: {error}");
                            (
                                UsageUpdate {
                                    snapshot: None,
                                    error: Some(error),
                                },
                                false,
                            )
                        }
                    };
                    let _ = usage_handle.emit(USAGE_UPDATED, update);
                    let (delay, next_backoff) = next_poll_delay(ok, backoff);
                    backoff = next_backoff;
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            directory::add_directory,
            directory::list_directories,
            directory::remove_directory,
            directory::discover_directories,
            settings::get_settings,
            settings::set_settings,
            pty::spawn_session,
            pty::write_session,
            pty::resize_session,
            pty::kill_session,
            pty::list_sessions,
            pty::set_session_paused,
            commander::spawn_commander_session,
            usage::get_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }

    /// A successful poll waits the steady interval and resets the backoff so the
    /// next failure starts from the base delay again.
    #[test]
    fn next_poll_delay_uses_steady_interval_and_resets_on_success() {
        assert_eq!(
            next_poll_delay(true, 40),
            (POLL_INTERVAL_SECS, RETRY_BASE_SECS)
        );
    }

    /// Consecutive failures wait the current backoff now and double it for next
    /// time — fast first retry, growing thereafter.
    #[test]
    fn next_poll_delay_backs_off_exponentially_on_failure() {
        assert_eq!(
            next_poll_delay(false, RETRY_BASE_SECS),
            (RETRY_BASE_SECS, RETRY_BASE_SECS * 2)
        );
        assert_eq!(next_poll_delay(false, 20), (20, 40));
    }

    /// Backoff never grows past the cap (asserted relative to the constant so
    /// it holds regardless of the configured cap value).
    #[test]
    fn next_poll_delay_caps_backoff_at_max() {
        // Doubling from just below the cap lands exactly on the cap, not past.
        let near = RETRY_MAX_SECS - 1;
        assert_eq!(next_poll_delay(false, near), (near, RETRY_MAX_SECS));
        // At the cap it stays capped.
        assert_eq!(
            next_poll_delay(false, RETRY_MAX_SECS),
            (RETRY_MAX_SECS, RETRY_MAX_SECS)
        );
    }
}
