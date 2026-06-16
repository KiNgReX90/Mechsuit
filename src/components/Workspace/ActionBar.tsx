/**
 * Workspace action bar.
 *
 * The standard row of workspace actions. The first action, "add terminal",
 * spawns a new session in the selected directory via the supplied callback.
 * Actions are disabled when no directory is selected.
 */
export interface ActionBarProps {
  /** Whether a directory is currently selected (actions require one). */
  hasDirectory: boolean;
  /** Spawn a new terminal session in the selected directory. */
  onAddTerminal: () => void;
}

export function ActionBar({ hasDirectory, onAddTerminal }: ActionBarProps) {
  return (
    <div className="workspace-action-bar" role="toolbar" aria-label="Workspace actions">
      <button
        type="button"
        className="workspace-action workspace-action--add"
        aria-label="Add terminal"
        disabled={!hasDirectory}
        onClick={onAddTerminal}
      >
        + add terminal
      </button>
    </div>
  );
}
