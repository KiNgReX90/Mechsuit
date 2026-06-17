import { useEffect, useRef } from "react";

import { Terminal } from "../Terminal";
import "./Commander.css";

export interface CommanderProps {
  /** Whether the drawer is folded out. */
  open: boolean;
  /** The live Commander PTY session id, or null when not yet spawned / exited. */
  sessionId: string | null;
  /** Fold the drawer in. */
  onClose: () => void;
  /** Spawn a fresh Commander process (used after it exits). */
  onRelaunch: () => void;
}

/**
 * Commander drawer: a glass panel on the right that hosts the Commander as a
 * live interactive `claude` terminal (so space-bar voice and every interactive
 * feature work). The terminal stays MOUNTED while folded — the panel is hidden
 * via a transform + `aria-hidden`, not unmounted — so the process and scrollback
 * survive folding. Open-state and the session id live in the app wiring.
 */
export function Commander({ open, sessionId, onClose, onRelaunch }: CommanderProps) {
  const drawerRef = useRef<HTMLElement>(null);

  // Fold in on a pointer-down anywhere outside the drawer (e.g. clicking a
  // terminal or the sidebar). Pointer-down — not focus loss — so a programmatic
  // focus change never collapses a drawer the user just opened.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const drawer = drawerRef.current;
      if (drawer && !drawer.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose]);

  // Put keyboard focus in the terminal whenever the drawer opens, so typing and
  // voice work immediately. xterm renders a helper <textarea> inside the pane.
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector("textarea")?.focus();
  }, [open, sessionId]);

  // Never opened and nothing to keep alive → render nothing at all.
  if (!open && sessionId == null) return null;

  return (
    <aside
      ref={drawerRef}
      className={`commander-drawer ${open ? "commander-drawer--open" : "commander-drawer--closed"}`}
      role="dialog"
      aria-label="Commander"
      aria-hidden={open ? undefined : true}
    >
      <div className="commander-header">
        <span className="commander-title">
          <CommanderEmblem />
          Commander
        </span>
        <button
          type="button"
          className="commander-close"
          aria-label="Close Commander"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="commander-body">
        {sessionId != null ? (
          <Terminal sessionId={sessionId} />
        ) : (
          <div className="commander-relaunch">
            <p>Commander exited.</p>
            <button
              type="button"
              className="commander-relaunch-button"
              onClick={onRelaunch}
            >
              Relaunch Commander
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Commander emblem: a hexagonal mech sigil with a downward double-chevron
 * (a "command" mark). Inherits the accent color via `currentColor`.
 */
function CommanderEmblem() {
  return (
    <svg
      className="commander-icon"
      data-testid="commander-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 2.2 20.3 7v10L12 21.8 3.7 17V7L12 2.2Z"
        fill="rgba(91,140,255,0.16)"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="m8.4 9.3 3.6 3.1 3.6-3.1M8.4 13.2l3.6 3.1 3.6-3.1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
