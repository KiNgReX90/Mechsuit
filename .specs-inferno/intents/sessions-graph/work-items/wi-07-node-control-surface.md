---
id: wi-07-node-control-surface
title: Node control surface — navigate, pause/resume, kill
intent: sessions-graph
kind: ui
complexity: medium
mode: autopilot
status: pending
depends_on: [wi-06-graph-view]
created: 2026-06-17
---

# Work Item: Node control surface — navigate, pause/resume, kill

## Description

Make the graph a control surface by wiring interactions onto the wi-06 nodes.
Clicking a terminal or subagent node navigates to that session in the workspace:
set `selectedDirectoryPath` + `expandedSessionId` via `uiStore` and close the
graph (`setGraphOpen(false)`). Each terminal node offers inline pause/resume via
`setSessionPaused` and kill via `killSession`, with a confirmation before kill.
Paused sessions are visibly marked (consistent with `pausedStore`) and offer
resume. Mirror the existing `Workspace/SessionActions` pattern.

## Acceptance Criteria

- [ ] Clicking a terminal/subagent node navigates: selects its directory, expands its session, and closes the graph.
- [ ] Each terminal node exposes pause/resume (toggles `setSessionPaused`) and kill (`killSession`); kill prompts for confirmation first.
- [ ] Paused sessions are visibly marked (consistent with `pausedStore`) and offer resume.
- [ ] Actions target the correct underlying `sessionId` and update live; aggregate nodes (repo/worktree) offer only expand/navigate, not pause/kill.
- [ ] Tests cover navigate wiring + the kill-confirmation flow (mocking IPC); `npm test` + `npm run build` pass.

## Execution Manifest

context:
  required:
    - path: src/components/SessionsGraph/GraphNode.tsx
      reason: the node to attach actions to (from wi-06)
    - path: src/components/Workspace/SessionActions.tsx
      reason: existing pause/resume/kill + confirmation pattern to mirror
    - path: src/state/uiStore.ts
      reason: setSelectedDirectoryPath / setExpandedSessionId / setGraphOpen for navigate
    - path: src/ipc/commands.ts
      reason: setSessionPaused + killSession (existing commands the actions call)
    - path: src/state/pausedStore.ts
      reason: paused state to reflect on nodes
  patterns:
    - path: src/components/Workspace/SessionActions.tsx
      reason: action buttons + confirmation flow to mirror
    - path: src/components/Workspace/SessionActions.test.tsx
      reason: action + confirmation test convention
  tests:
    - path: src/components/Workspace/SessionActions.test.tsx
      reason: test style for action + confirmation flows
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/components/SessionsGraph/GraphNode.tsx
    - src/components/SessionsGraph/NodeActions.tsx
    - src/components/SessionsGraph/NodeActions.test.tsx

## Technical Notes

Navigate must work for a subagent node too — resolve it to its owning terminal
session before selecting/expanding. Overlaps wi-06 on `GraphNode.tsx`; not
concurrent (depends_on wi-06), so the orchestrator serializes them. Reuse the
existing commands — no new backend.

## Dependencies

- wi-06-graph-view
