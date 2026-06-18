import { useEffect } from "react";

import "./CollectedWorkspace.css";

export interface CollectedWorkspaceProps {
  /** Whether the collected view is shown over the workspace body. */
  open: boolean;
  /** Dismiss the view. */
  onClose: () => void;
}

/**
 * Collected view: a dumb full-body container that overlays the sidebar +
 * workspace when {@link CollectedWorkspaceProps.open} is true and renders
 * nothing when closed.
 *
 * It owns only the open/close shell — a header with a close button plus an empty
 * body slot — and is closable via that button or the Escape key. The real bay
 * layout lands in a later item (wi-04) that fills the `.collected-workspace-body`
 * slot inside this folder.
 */
export function CollectedWorkspace({ open, onClose }: CollectedWorkspaceProps) {
  // Escape closes the view while it is open.
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
      className="collected-workspace"
      role="dialog"
      aria-label="Collected view"
    >
      <div className="collected-workspace-header">
        <span className="collected-workspace-title">Collected view</span>
        <button
          type="button"
          className="collected-workspace-close"
          aria-label="Close Collected view"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* Body slot: the bay layout (wi-04) mounts here. */}
      <div className="collected-workspace-body" />
    </section>
  );
}

export default CollectedWorkspace;
