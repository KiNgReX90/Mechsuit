/**
 * Window-control helpers for the custom (borderless) title bar.
 *
 * The app runs with `decorations: false`, so the title bar's minimize /
 * maximize-restore / close buttons drive the native window through the Tauri
 * window API. Wrapping `getCurrentWindow()` here (mirroring `commands.ts` and
 * `events.ts`) keeps the Tauri import in one place and lets components mock the
 * window surface in tests.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";

/** Minimize the window to the taskbar/dock. */
export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

/** Toggle between maximized (fills the work area) and the restored size. */
export function toggleMaximizeWindow(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

/** Close the window (quits the app when it is the last window). */
export function closeWindow(): Promise<void> {
  return getCurrentWindow().close();
}

/** Whether the window is currently maximized — drives the middle button's icon. */
export function isWindowMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

/**
 * Subscribe to window resizes; returns an unlisten function. Maximize and
 * restore both emit a resize, so the title bar re-reads `isWindowMaximized()`
 * here to keep the middle button's icon in sync however the state changed
 * (button, double-click on the drag region, or OS shortcut).
 */
export function onWindowResized(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWindow().onResized(() => cb());
}
