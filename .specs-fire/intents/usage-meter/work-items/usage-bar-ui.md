---
id: usage-bar-ui
title: Usage bar UI — bottom footer component (bars + % + reset + color thresholds), live wiring into App shell
intent: usage-meter
kind: feature
complexity: medium
mode: autopilot
status: pending
depends_on: [usage-store-countdown, usage-ipc-contract]
created: 2026-06-16T14:36:19Z
---

# Work Item: Usage bar UI — bottom footer component (bars + % + reset + color thresholds), live wiring into App shell

## Description

The visible footer meter and its live data wiring.

- New `src/components/UsageBar/` (`UsageBar.tsx`, `UsageBar.css`, `index.ts`, `UsageBar.test.tsx`),
  following the existing component-folder convention (see `src/components/Sidebar/`):
  - Renders **both windows** — 5-hour and weekly — each as a **small progress bar** (width =
    `utilization`%), the **integer %**, and the **reset countdown** via `formatCountdown(resetsAt)`,
    e.g. `5h ▓▓▓▓▓░░░░░ 49% · resets 2h13m   wk ▓▓▓░░░░░░░ 31% · 6d`.
  - **Color thresholds:** apply a class from `usageLevel(utilization)` (`ok`/`warn`/`crit` →
    green/amber/red) to each window's bar + value.
  - **Unavailable state:** when `snapshot` is null (or `error` set), render a muted
    "usage unavailable" line instead of bars — never throw.
  - **Live data:** on mount, prime once via `getUsage()` → `usageStore.applyUpdate({snapshot,...})`
    (swallow rejection into the error state), and subscribe to `onUsageUpdated` →
    `applyUpdate`, unsubscribing on unmount (follow `App.tsx`'s existing
    `onCommanderDirectoriesChanged` subscribe/dispose pattern). Read display state from
    `usageStore`.
- Wire into the app shell:
  - `src/App.tsx` — mount `<UsageBar />` as a bottom footer region of `.app-shell`.
  - `src/App.css` — lay out `.app-shell` so the footer is a slim full-width bar pinned to the
    bottom (below the sidebar + workspace row); style the progress bars and the
    `ok`/`warn`/`crit` colors.

## Acceptance Criteria

- [ ] The footer shows both windows with a proportional bar, integer %, and reset countdown;
      always visible at the bottom of the window, full width.
- [ ] Bar/value color reflects `usageLevel` (green/amber/red) at the configured thresholds.
- [ ] With no/failed data the bar shows a muted "usage unavailable" state and does not crash.
- [ ] On mount it primes via `getUsage()` and thereafter updates from `usage://updated`;
      subscription is torn down on unmount.
- [ ] A component test renders a known `UsageSnapshot` (via the store) and asserts the
      percentages, countdown text, and color class for a high-utilization window; and asserts
      the unavailable state renders without error.
- [ ] `npm test` and `npm run build` pass.

## Team Execution Manifest

context:
  required:
    - path: src/App.tsx
      reason: mount <UsageBar/> in the app shell; reuse its event subscribe/dispose lifecycle pattern (single-owner)
    - path: src/App.css
      reason: add the bottom footer layout + progress-bar + threshold-color styles (single-owner)
    - path: src/state/usageStore.ts
      reason: the store this component reads/updates (from usage-store-countdown)
    - path: src/lib/usageFormat.ts
      reason: formatCountdown + usageLevel helpers this component renders with (from usage-store-countdown)
    - path: src/ipc/events.ts
      reason: onUsageUpdated subscriber + getUsage command used for live data + priming (from usage-ipc-contract)
  patterns:
    - path: src/components/Sidebar/Sidebar.tsx
      reason: component-folder structure, CSS import, and store-driven rendering to mirror
    - path: src/App.tsx
      reason: onCommanderDirectoriesChanged subscribe-then-dispose effect to mirror for onUsageUpdated
    - path: src/components/Sidebar/Sidebar.test.tsx
      reason: Testing-Library render/assert convention for a store-driven component
  tests:
    - path: src/components/Sidebar/Sidebar.test.tsx
      reason: mirror render + assertion style for UsageBar.test.tsx
ownership:
  editable:
    - src/components/UsageBar/
    - src/App.tsx
    - src/App.css

## Technical Notes

Medium-complexity: a new presentational component plus its subscription lifecycle and the
app-shell layout change. All number→string formatting and the color thresholds come from
`usageFormat.ts` (no magic numbers in the component). Keep the bar purely a function of store
state so the test can drive it by seeding the store. Render `<1` and `100` cleanly (clamp bar
width to 0–100). Match the existing dark theme; the footer should be slim (single line) and not
steal vertical space from the workspace grid.

## Dependencies

- usage-store-countdown
- usage-ipc-contract
