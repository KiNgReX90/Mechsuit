import { useEffect, useState } from "react";

import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "../../ipc/window";

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
