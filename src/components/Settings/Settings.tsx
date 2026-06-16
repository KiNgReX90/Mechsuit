import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useSettingsStore } from "../../state/settingsStore";

import "./Settings.css";

export interface SettingsProps {
  /** Whether the panel is visible. Open-state lives in the host (Sidebar). */
  open: boolean;
  /** Dismiss the panel. */
  onClose: () => void;
}

/**
 * Settings panel.
 *
 * A drawer over the app shell with a labeled workspace-root field and a save
 * action. The current root is read from {@link useSettingsStore}; saving calls
 * `setWorkspaceRoot`, so the next add-directory discovery reflects the new root.
 * The panel loads settings once on open and seeds the field from the store,
 * then tracks edits locally until saved. Returns null when closed.
 */
export function Settings({ open, onClose }: SettingsProps) {
  const workspaceRoot = useSettingsStore((s) => s.settings.workspaceRoot);
  const load = useSettingsStore((s) => s.load);
  const setWorkspaceRoot = useSettingsStore((s) => s.setWorkspaceRoot);

  const [draft, setDraft] = useState(workspaceRoot);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // On open, refresh from the backend and put the cursor straight in the field.
  useEffect(() => {
    if (!open) return;
    void load();
    inputRef.current?.focus();
  }, [open, load]);

  // Keep the field in sync with the store's current value while open (e.g. once
  // load() resolves), without clobbering edits the user is mid-typing.
  useEffect(() => {
    if (open) setDraft(workspaceRoot);
  }, [open, workspaceRoot]);

  if (!open) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    void (async () => {
      try {
        await setWorkspaceRoot(draft.trim());
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <aside className="settings-drawer" role="dialog" aria-label="Settings">
      <div className="settings-header">
        <span className="settings-title">Settings</span>
        <button
          type="button"
          className="settings-close"
          aria-label="Close Settings"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <form className="settings-form" onSubmit={handleSubmit}>
        <label className="settings-field">
          <span className="settings-label">Workspace root</span>
          <input
            ref={inputRef}
            type="text"
            className="settings-input"
            placeholder="/home/you/dev"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={saving}
          />
        </label>
        <p className="settings-hint">
          Where discovery looks for projects to add.
        </p>
        <button type="submit" className="settings-save" disabled={saving}>
          Save
        </button>
      </form>
    </aside>
  );
}
