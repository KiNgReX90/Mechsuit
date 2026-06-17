/**
 * Bottom footer usage meter.
 *
 * Renders the two rolling-window usage buckets (5-hour + weekly) from the
 * backend meter, each as a slim proportional progress bar, its integer
 * utilization %, and the reset countdown. Bar + value carry a semantic level
 * class (ok/warn/crit) derived from `usageLevel`. When no snapshot is available
 * (or an error is set) it shows a muted "usage unavailable" line instead of
 * bars and never throws.
 *
 * Display state comes entirely from `useUsageStore`, so the component is a pure
 * function of store state (tests drive it by seeding the store). The live data
 * lifecycle mirrors `App.tsx`'s `onCommanderDirectoriesChanged` effect: prime
 * once on mount via `getUsage()`, then subscribe to `usage://updated`, and tear
 * the subscription down on unmount. This component is the single owner of that
 * subscription.
 */
import { useEffect } from "react";

import { getUsage } from "../../ipc/commands";
import { onUsageUpdated } from "../../ipc/events";
import { formatCountdown, usageLevel } from "../../lib/usageFormat";
import { useUsageStore } from "../../state/usageStore";
import type { UsageWindow } from "../../types";

import "./UsageBar.css";

/** Clamp a utilization value to the renderable 0–100 bar-width range. */
function clampWidth(utilization: number): number {
  if (utilization < 0) return 0;
  if (utilization > 100) return 100;
  return utilization;
}

/** A single labelled window: proportional bar + integer % + reset countdown. */
function Window({ label, window }: { label: string; window: UsageWindow }) {
  const level = usageLevel(window.utilization);
  const width = clampWidth(window.utilization);
  const pct = Math.round(window.utilization);

  return (
    <div
      className={`usage-bar-window usage-bar-window--${level}`}
      data-level={level}
    >
      <span className="usage-bar-label">{label}</span>
      <span className="usage-bar-track" aria-hidden="true">
        <span className="usage-bar-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="usage-bar-value">{pct}%</span>
      <span className="usage-bar-reset">
        · resets {formatCountdown(window.resetsAt)}
      </span>
    </div>
  );
}

function UsageBar() {
  const snapshot = useUsageStore((s) => s.snapshot);
  const lastUpdated = useUsageStore((s) => s.lastUpdated);
  const applyUpdate = useUsageStore((s) => s.applyUpdate);

  // Prime once via getUsage(), then live-update from `usage://updated`,
  // unsubscribing on unmount — mirrors App.tsx's subscribe/dispose effect.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getUsage()
      .then((s) => applyUpdate({ snapshot: s, error: null }))
      .catch((e: unknown) =>
        applyUpdate({ snapshot: null, error: String(e) }),
      );

    void onUsageUpdated((u) => applyUpdate(u)).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyUpdate]);

  return (
    <footer className="usage-bar" aria-label="API usage">
      {snapshot ? (
        // A snapshot is shown whenever we have one — it survives transient
        // errors (last-good wins) so the meter never flickers to a failure
        // state on a single missed poll.
        <>
          <Window label="5h" window={snapshot.fiveHour} />
          <Window label="wk" window={snapshot.sevenDay} />
        </>
      ) : lastUpdated === null ? (
        // Boot: the first fetch is in flight. Not a failure — don't cry wolf.
        <span className="usage-bar-loading">loading usage…</span>
      ) : (
        // We tried at least once and have no data to show.
        <span className="usage-bar-unavailable">usage unavailable</span>
      )}
    </footer>
  );
}

export default UsageBar;
