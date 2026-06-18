import { useEffect } from "react";

import "./SessionsGraph.css";

export interface SessionsGraphProps {
  /** Whether the graph screen is shown over the workspace body. */
  open: boolean;
  /** Dismiss the screen. */
  onClose: () => void;
}

/**
 * Sessions graph screen: a dumb full-body container that overlays the workspace
 * when {@link SessionsGraphProps.open} is true and renders nothing when closed.
 *
 * It owns only the open/close shell — a header with a close button plus an empty
 * canvas slot — and is closable via that button or the Escape key. The actual
 * graph rendering (GraphCanvas / GraphNode) lands in a later item that fills the
 * `.sessions-graph-canvas` slot inside this folder.
 */
export function SessionsGraph({ open, onClose }: SessionsGraphProps) {
  // Escape closes the screen while it is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <section
      className="sessions-graph"
      role="dialog"
      aria-label="Sessions graph"
    >
      <div className="sessions-graph-header">
        <span className="sessions-graph-title">Sessions graph</span>
        <button
          type="button"
          className="sessions-graph-close"
          aria-label="Close Sessions graph"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* Canvas slot: a later item mounts the graph renderer here. */}
      <div className="sessions-graph-canvas" />
    </section>
  );
}

export default SessionsGraph;
