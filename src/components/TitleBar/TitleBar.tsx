import { useEffect, useState } from "react";

import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "../../ipc/window";
import { useUiStore } from "../../state/uiStore";

import "./TitleBar.css";

/**
 * Custom title bar for the borderless (`decorations: false`) window.
 *
 * The bar background is a Tauri drag region (`data-tauri-drag-region`) so the
 * window can be moved and double-clicked to toggle maximize, while the three
 * controls on the right drive the window through the {@link "../../ipc/window"}
 * wrapper. The middle control reflects the maximized state — "Restore" when
 * maximized, "Maximize" otherwise — and re-reads that state on every resize so
 * it stays correct however the window changed (button, double-click, or OS).
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const toggleSettings = useUiStore((s) => s.toggleSettings);
  const graphOpen = useUiStore((s) => s.graphOpen);
  const toggleGraph = useUiStore((s) => s.toggleGraph);
  const collectedOpen = useUiStore((s) => s.collectedOpen);
  const toggleCollected = useUiStore((s) => s.toggleCollected);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const sync = () => {
      void isWindowMaximized().then((value) => {
        if (!disposed) setMaximized(value);
      });
    };

    sync();
    void onWindowResized(sync).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <header className="title-bar" data-tauri-drag-region>
      <div className="title-bar-leading">
        <button
          type="button"
          className="title-bar-button title-bar-button--settings"
          aria-label="Settings"
          title="Settings"
          aria-expanded={settingsOpen}
          onClick={() => toggleSettings()}
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <button
          type="button"
          className="title-bar-button title-bar-button--graph"
          aria-label="Sessions graph"
          title="Sessions graph"
          aria-expanded={graphOpen}
          onClick={() => toggleGraph()}
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="2.4" />
            <circle cx="18" cy="7" r="2.4" />
            <circle cx="12" cy="18" r="2.4" />
            <path d="M7.9 7.4 10.4 16M16.4 9 12.9 16M8 6.4h7.6" />
          </svg>
        </button>

        <button
          type="button"
          className="title-bar-button title-bar-button--collected"
          aria-label="Collected view"
          title="Collected view"
          aria-expanded={collectedOpen}
          onClick={() => toggleCollected()}
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
            <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
          </svg>
        </button>
      </div>

      <span className="title-bar-brand" data-tauri-drag-region>
        <span className="title-bar-mark" aria-hidden="true" />
        Mechsuit
      </span>

      <div className="title-bar-controls">
        <button
          type="button"
          className="title-bar-button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => void minimizeWindow()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          className="title-bar-button"
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => void toggleMaximizeWindow()}
        >
          {maximized ? (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              {/* Front window square. */}
              <rect x="2.8" y="5.2" width="7.6" height="7.6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
              {/* Visible top+right of the window behind it (no fill mask needed). */}
              <path d="M5.4 5.2V3.1h7.6v7.6h-2.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="3.3" y="3.3" width="9.4" height="9.4" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="title-bar-button title-bar-button--close"
          aria-label="Close"
          title="Close"
          onClick={() => void closeWindow()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}

export default TitleBar;
