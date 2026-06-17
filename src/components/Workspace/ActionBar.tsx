/**
 * Workspace action bar.
 *
 * Pairs a single "add terminal" button with quick-spawn options. The add button
 * spawns one session in the selected directory; each quick option fills the
 * workspace to a fixed terminal count (2/4/6/8), spawning just enough to reach
 * it — so an option only appears while the count is still below its target.
 * Both are disabled when no directory is selected.
 */
import { quickSpawnTargets, spawnsToReach } from "../../lib/quickSpawn";
import { useUiStore } from "../../state/uiStore";

export interface ActionBarProps {
  /** Whether a directory is currently selected (actions require one). */
  hasDirectory: boolean;
  /** How many terminals are currently open in the selected directory. */
  sessionCount: number;
  /** Spawn `count` new terminal sessions in the selected directory. */
  onSpawnTerminals: (count: number) => void;
}

/** The grid shape (cols × rows) a quick-spawn option's icon previews. */
function gridShapeFor(target: number): { cols: number; rows: number } {
  switch (target) {
    case 2:
      return { cols: 2, rows: 1 };
    case 4:
      return { cols: 2, rows: 2 };
    case 6:
      return { cols: 3, rows: 2 };
    default:
      return { cols: 4, rows: 2 };
  }
}

/** Decorative mini-grid glyph: `cols × rows` filled cells in a 16×16 box. */
function GridGlyph({ cols, rows }: { cols: number; rows: number }) {
  const pad = 2;
  const gap = 1.4;
  const size = 16;
  const cw = (size - pad * 2 - gap * (cols - 1)) / cols;
  const ch = (size - pad * 2 - gap * (rows - 1)) / rows;
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={pad + c * (cw + gap)}
          y={pad + r * (ch + gap)}
          width={cw}
          height={ch}
          rx={1}
        />,
      );
    }
  }
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      {cells}
    </svg>
  );
}

export function ActionBar({
  hasDirectory,
  sessionCount,
  onSpawnTerminals,
}: ActionBarProps) {
  const targets = hasDirectory ? quickSpawnTargets(sessionCount) : [];
  const commanderOpen = useUiStore((s) => s.commanderOpen);
  const toggleCommander = useUiStore((s) => s.toggleCommander);

  return (
    <div
      className="workspace-action-bar"
      role="toolbar"
      aria-label="Workspace actions"
    >
      <button
        type="button"
        className="workspace-action workspace-action--add"
        aria-label="Add terminal"
        title="Add terminal"
        disabled={!hasDirectory}
        onClick={() => onSpawnTerminals(1)}
      >
        {/* A terminal window with a prompt and a small "+" badge — distinct
            from the sidebar's bare workspace plus. */}
        <svg
          viewBox="0 0 18 18"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="1.5" y="3.5" width="11" height="11" rx="2" />
          <path d="M4.3 7.2l2 1.8-2 1.8" />
          <path d="M7.6 11h2.4" />
          <path d="M14.5 1.8v3.4M12.8 3.5h3.4" />
        </svg>
      </button>

      {targets.map((target) => {
        const { cols, rows } = gridShapeFor(target);
        return (
          <button
            key={target}
            type="button"
            className="workspace-action workspace-action--quick"
            aria-label={`Open ${target} terminals`}
            title={`Open ${target} terminals`}
            onClick={() => onSpawnTerminals(spawnsToReach(sessionCount, target))}
          >
            <GridGlyph cols={cols} rows={rows} />
          </button>
        );
      })}

      <span className="workspace-action-spacer" aria-hidden="true" />

      <button
        type="button"
        className={
          commanderOpen
            ? "workspace-action workspace-action--commander workspace-action--commander-active"
            : "workspace-action workspace-action--commander"
        }
        aria-label="Commander"
        aria-pressed={commanderOpen}
        title="Commander (Ctrl+Shift+C)"
        onClick={toggleCommander}
      >
        {/* Commander hex sigil with a downward double-chevron (matches the
            drawer emblem). */}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
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
      </button>
    </div>
  );
}
