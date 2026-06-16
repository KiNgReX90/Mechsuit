---
id: sidebar-status-dots
title: Sidebar Status Dots — per-directory ready/waiting/error aggregation
status: pending
created: 2026-06-16T05:01:06Z
---

# Intent: Sidebar Status Dots — per-directory ready/waiting/error aggregation

## Goal

On each directory button in the sidebar, show up to three status dots — **green (ready)**,
**orange (waiting / awaiting approval)**, **red (error)** — each with a **count** of matching
sessions inside it, so the user sees at a glance which directories have sessions needing
attention without entering them.

## Users

The developer working inside one directory's workspace while sessions in other directories
continue running and changing state out of view.

## Problem

When focused on one directory's workspace, sessions in OTHER directories may finish, block on
approval, or error — invisibly. Aggregated per-directory dots surface that state across all
directories at once, in the sidebar that's always on screen.

## Success Criteria

- Each directory button aggregates its sessions' statuses into counts:
  **ready** (green), **waiting / awaiting-approval** (orange), **error** (red).
- Each dot shows its **count inside** it.
- A dot is **hidden when its count is zero** (no green dot if nothing is ready, etc.).
- Within a button, dots are ordered by priority: **error (red) → awaiting (orange) →
  ready (green)**.
- Directories keep their **user-added order** — NO urgency re-sorting of the list
  (user decision, 2026-06-16).
- Counts update **live** as session statuses change; acknowledging a ready session
  decrements its directory's green count.

## Constraints

- Builds on `foundation-terminal-grid` AND consumes the session statuses produced by
  `session-status-engine` — **this intent depends on that one**.
- Edits the Sidebar button rendering (`src/components/Sidebar/`) and reads aggregated
  per-directory status from the stores; does not introduce new backend commands.
- Dots ordering is **within-button only**; the directory list order is unchanged
  (user decision).

## Notes

**Depends on `foundation-terminal-grid` and `session-status-engine`.** Capture/decompose
**after** `session-status-engine`, since the dots aggregate its statuses.

Open items to resolve at decomposition:
- Visual design of the dots (size, placement relative to the path + branch text in the
  button).
- "Waiting" = awaiting-approval (orange). Plain `working` sessions get NO dot — only the
  three states (ready/waiting/error) are surfaced.
