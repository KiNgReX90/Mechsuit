---
id: wi-04-graph-model-store
title: Graph data model + store
intent: sessions-graph
kind: architecture
complexity: medium
mode: autopilot
status: pending
depends_on: [wi-01-worktree-discovery, wi-02-subagent-detection, wi-03-node-status-rollup]
created: 2026-06-17
---

# Work Item: Graph data model + store

## Description

Frontend store `src/state/graphStore.ts` (with a colocated test) that assembles
the unified mission-control tree the graph view renders. It composes: managed
directories (`directoriesStore`), per-directory sessions (`sessionsStore`),
per-session status (`statusStore`), worktrees (`listWorktrees`, wi-01), and
subagents (`subagentStore`, wi-02) into a tree of nodes
`repo → worktree → terminal → subagent`. Each non-leaf node's status is computed
with wi-03's `rollupStatus`. The store starts wi-02's subagent engine
(`startSubagentEngine`) so subagents are derived from the PTY stream while the
graph is live, reads `subagentStore`, and refreshes worktrees; it exposes a
selector hook for the view. Stores/IPC are mocked in tests.

## Acceptance Criteria

- [ ] Produces a tree: each managed repo is a root; its worktrees are children; each terminal session sits under the worktree matching its `dirPath` (falling back to the repo root when no worktree matches); each session's subagents are its children.
- [ ] Every node carries `id`, `kind` (`repo` | `worktree` | `terminal` | `subagent`), `label`, and a status (leaf = own `SessionStatus`; parent = `rollupStatus` of descendants).
- [ ] Live: updates when sessions/status change and when `subagentStore` changes (wi-02's engine derives subagents from the PTY stream); worktrees refresh on demand.
- [ ] A session whose `dirPath` equals a worktree path nests under that worktree (demonstrates the worktree↔terminal mapping).
- [ ] Unit tests (mocking IPC/events + the other stores) cover tree assembly, worktree nesting, and status roll-up wiring; `npm test` + `npm run build` pass.

## Execution Manifest

context:
  required:
    - path: src/state/sessionsStore.ts
      reason: sessions keyed by directory — a primary input
    - path: src/state/statusStore.ts
      reason: per-session SessionStatus — a primary input
    - path: src/state/directoriesStore.ts
      reason: managed directories list — the repo roots
    - path: src/lib/nodeStatus.ts
      reason: rollupStatus + pulse descriptors (from wi-03)
    - path: src/ipc/commands.ts
      reason: listWorktrees wrapper (from wi-01)
    - path: src/state/subagentStore.ts
      reason: per-session subagents derived from the PTY stream (from wi-02)
    - path: src/state/subagentEngine.ts
      reason: startSubagentEngine — begins deriving subagents while the graph is live (from wi-02)
  patterns:
    - path: src/state/statusStore.ts
      reason: zustand store shape + actions convention
    - path: src/state/statusEngine.ts
      reason: pattern for subscribing to ipc events with proper teardown
  tests:
    - path: src/state/statusStore.test.ts
      reason: store test convention (mocking ipc) to mirror
    - path: src/state/sessionsStore.test.ts
      reason: store-with-ipc test convention
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/state/graphStore.ts
    - src/state/graphStore.test.ts

## Technical Notes

Keep assembly as a pure function over inputs where possible (testable without a
live store), with a thin zustand/subscription wrapper for liveness — mirror how
`statusEngine` owns subscriptions while `statusStore` stays passive. Worktree
match is by exact `dirPath` === worktree path; unmatched sessions attach to the
repo root.

## Dependencies

- wi-01-worktree-discovery
- wi-02-subagent-detection
- wi-03-node-status-rollup
