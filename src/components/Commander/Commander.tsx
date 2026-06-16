import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";

import type { CommanderEngine } from "../../lib/commander/types";
import "./Commander.css";

/** A single turn in the Commander conversation, tagged by author. */
interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface CommanderProps {
  /** Whether the overlay is visible. Open-state lives in the app wiring. */
  open: boolean;
  /** Dismiss the overlay. */
  onClose: () => void;
  /** The engine the overlay converses with (injected; mocked in tests). */
  engine: CommanderEngine;
}

/**
 * Commander chat overlay.
 *
 * A floating panel over the workspace grid: a scrollable message list, a text
 * input + send, and a close control. Assistant replies render as markdown
 * (via `react-markdown`); user messages render plain.
 *
 * Conversation history lives in local state and persists while mounted. The
 * driver's `sessionId` is threaded across turns so one conversation continues:
 * the first `ask` omits it, and each returned id is fed back into the next call.
 * The overlay codes only against the {@link CommanderEngine} interface — it
 * never imports the driver command — which keeps it testable with a mock.
 */
export function Commander({ open, onClose, engine }: CommanderProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Put the cursor straight in the message field whenever the overlay opens
  // (e.g. via the Ctrl+Shift+C hotkey), so the user can type immediately
  // without first clicking into it.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || pending) return;

    setTurns((prev) => [...prev, { role: "user", text: message }]);
    setInput("");
    setPending(true);

    void (async () => {
      try {
        const result = await engine.ask(message, sessionId);
        setSessionId(result.sessionId);
        setTurns((prev) => [...prev, { role: "assistant", text: result.reply }]);
      } finally {
        setPending(false);
      }
    })();
  };

  return (
    <aside className="commander-drawer" role="dialog" aria-label="Commander">
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

      <div className="commander-messages" data-testid="commander-messages">
        {turns.length === 0 && !pending && (
          <p className="commander-empty">
            Ask Commander to find a project, open sessions, or steer the fleet.
          </p>
        )}
        {turns.map((turn, index) => (
          <div
            key={index}
            className={`commander-message commander-message--${turn.role}`}
          >
            {turn.role === "assistant" ? (
              <ReactMarkdown>{turn.text}</ReactMarkdown>
            ) : (
              turn.text
            )}
          </div>
        ))}
        {pending && (
          <div className="commander-pending" data-testid="commander-pending">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form className="commander-input-row" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="commander-input"
          aria-label="Message Commander"
          placeholder="Ask Commander…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={pending}
        />
        <button
          type="submit"
          className="commander-send"
          disabled={pending || input.trim().length === 0}
        >
          Send
        </button>
      </form>
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
