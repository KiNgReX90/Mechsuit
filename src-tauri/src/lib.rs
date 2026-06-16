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
/// immediately on startup; subsequent polls wait this long between refreshes.
const POLL_INTERVAL_SECS: u64 = 60;

pub fn run() {
    // One registry instance shared by the Tauri commands (managed state) and
    // the in-process MCP server (Commander); both must see the same sessions.
    let registry = SessionRegistry::default();

    tauri::Builder::default()
        .manage(registry.clone())
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

            // Background usage poller: capture the AppHandle (the emit target,
            // same pattern as mcp::start), fetch the Claude subscription usage
            // snapshot immediately on startup, then refresh every
            // POLL_INTERVAL_SECS. Each refresh emits USAGE_UPDATED carrying the
            // snapshot on success or the error string on failure.
            let usage_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let update = match usage::fetch_snapshot().await {
                        Ok(snapshot) => UsageUpdate {
                            snapshot: Some(snapshot),
                            error: None,
                        },
                        Err(error) => UsageUpdate {
                            snapshot: None,
                            error: Some(error),
                        },
                    };
                    let _ = usage_handle.emit(USAGE_UPDATED, update);
                    tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
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
            commander::commander_send,
            usage::get_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn smoke() {
        assert_eq!(2 + 2, 4);
    }
}
