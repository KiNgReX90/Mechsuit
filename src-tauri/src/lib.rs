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

use pty::SessionRegistry;
use tauri::Manager;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            directory::add_directory,
            directory::list_directories,
            directory::remove_directory,
            directory::discover_directories,
            pty::spawn_session,
            pty::write_session,
            pty::resize_session,
            pty::kill_session,
            pty::list_sessions,
            commander::commander_send,
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
