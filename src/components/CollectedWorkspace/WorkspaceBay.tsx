/**
 * One titled bay for a single workspace in the collected view.
 *
 * Renders a header (the directory's display name + git branch + the 2/4/6/8
 * quick-spawn controls and an add-terminal button, same semantics as the
 * Workspace ActionBar) over a shared <Grid> of that directory's sessions with
 * the per-tile expand control suppressed (the collected view has no
 * expand-to-fill). Focus, status borders, paused dimming, and close all behave
 * as in the normal grid — Grid already routes tile clicks through focusSession.
 *
 * Purely presentational: wired entirely by props so the store wiring (spawn /
 * close / active-workspaces) lives in the surrounding CollectedWorkspace
 * (wi-04). No store imports here.
 */
import { quickSpawnTargets, spawnsToReach } from "../../lib/quickSpawn";
import { Grid } from "../Workspace/Grid";
import type { DirectoryInfo, SessionInfo } from "../../types";
import "./WorkspaceBay.css";

export interface WorkspaceBayProps {
  /** The workspace this bay represents (display name + git branch). */
  directory: DirectoryInfo;
  /** The directory's live sessions, tiled in the bay body. */
  sessions: SessionInfo[];
  /** Currently focused session id (drives the accent tile border), or null. */
  focusedSessionId: string | null;
  /** Spawn `count` new terminals in this directory. */
  onSpawnTerminals: (count: number) => void;
  /** Close (kill) the session with `id`. */
  onCloseSession: (id: string) => void;
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

export function WorkspaceBay({
  directory,
  sessions,
  focusedSessionId,
  onSpawnTerminals,
  onCloseSession,
}: WorkspaceBayProps) {
  const targets = quickSpawnTargets(sessions.length);

  return (
    <section
      className="workspace-bay"
      data-testid="workspace-bay"
      data-dir-path={directory.path}
      aria-label={`Workspace ${directory.name}`}
    >
      <header className="workspace-bay-header">
        <div className="workspace-bay-title">
          <span className="workspace-bay-name" title={directory.path}>
            {directory.name}
          </span>
          {directory.branch && (
            <span className="workspace-bay-branch" title={`Branch ${directory.branch}`}>
              {directory.branch}
            </span>
          )}
        </div>

        <div
          className="workspace-bay-actions"
          role="toolbar"
          aria-label={`Spawn terminals in ${directory.name}`}
        >
          {targets.map((target) => {
            const { cols, rows } = gridShapeFor(target);
            return (
              <button
                key={target}
                type="button"
                className="workspace-bay-action workspace-bay-action--quick"
                aria-label={`Open ${target} terminals`}
                title={`Open ${target} terminals`}
                onClick={() => onSpawnTerminals(spawnsToReach(sessions.length, target))}
              >
                <GridGlyph cols={cols} rows={rows} />
              </button>
            );
          })}

          <button
            type="button"
            className="workspace-bay-action workspace-bay-action--add"
            aria-label="Add terminal"
            title="Add terminal"
            onClick={() => onSpawnTerminals(1)}
          >
            {/* A terminal window with a prompt and a small "+" badge. */}
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
        </div>
      </header>

      <div className="workspace-bay-body">
        <Grid
          sessions={sessions}
          focusedSessionId={focusedSessionId}
          onExpand={() => {}}
          onClose={onCloseSession}
          showExpand={false}
        />
      </div>
    </section>
  );
}
