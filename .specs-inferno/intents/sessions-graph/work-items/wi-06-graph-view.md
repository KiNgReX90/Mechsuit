---
id: wi-06-graph-view
title: Graph view — layout, pan/zoom, icons, pulse
intent: sessions-graph
kind: ui
complexity: high
mode: autopilot
status: pending
depends_on: [wi-04-graph-model-store, wi-05-topbar-screen-scaffold, wi-03-node-status-rollup]
created: 2026-06-17
---

# Work Item: Graph view — layout, pan/zoom, icons, pulse

## Description

The graph rendering itself, mounted inside the wi-05 container. Render the wi-04
tree as a full, always-expanded node graph with smooth pan/zoom, distinctive
icons per node kind (repo / worktree / terminal / subagent), and the four-state
pulse animation driven by wi-03's pulse descriptors: green=working,
orange=awaiting-approval, gray-still=ready, red=error. This is the visual
centerpiece.

**A design doc (`wi-06-graph-view-design.md`) precedes implementation** — it
settles the layout algorithm, the pan/zoom approach, node iconography, and the
pulse CSS. Build to the approved design.

## Acceptance Criteria

- [ ] Renders `repo → worktree → terminal → subagent` as a readable tree with connectors; the whole graph pans and zooms smoothly and stays usable with dozens of nodes.
- [ ] Each node shows its kind icon + label and pulses per its rolled-up status (ready/gray does NOT pulse); pulse colors match the spec.
- [ ] Live: the graph reflects wi-04 store updates (sessions/subagents appearing and vanishing) with no manual refresh.
- [ ] No interactions beyond pan/zoom yet (click/pause/kill are wi-07), but nodes expose a stable handle/prop for wi-07 to attach actions to.
- [ ] Render tests cover node rendering + the status→pulse class mapping; `npm test` + `npm run build` pass.

## Execution Manifest

context:
  required:
    - path: src/state/graphStore.ts
      reason: the tree to render (from wi-04)
    - path: src/lib/nodeStatus.ts
      reason: pulse descriptors driving node styling (from wi-03)
    - path: src/components/SessionsGraph/SessionsGraph.tsx
      reason: the container to mount the canvas into (from wi-05)
    - path: src/components/Workspace/Grid.tsx
      reason: pattern for laying out many nodes/tiles
    - path: src/components/Terminal/Terminal.tsx
      reason: pattern for a component with colocated CSS and status-driven styling
  patterns:
    - path: src/lib/gridLayout.ts
      reason: layout-computation-as-pure-lib pattern (keep layout math testable)
    - path: src/components/Workspace/Workspace.tsx
      reason: component structure + test conventions
  tests:
    - path: src/components/Workspace/Workspace.test.tsx
      reason: vitest + testing-library render-test convention
    - path: npm test
      reason: verification command
ownership:
  editable:
    - src/lib/graphLayout.ts
    - src/lib/graphLayout.test.ts
    - src/components/SessionsGraph/GraphCanvas.tsx
    - src/components/SessionsGraph/GraphNode.tsx
    - src/components/SessionsGraph/GraphCanvas.test.tsx
    - src/components/SessionsGraph/GraphNode.test.tsx

## Technical Notes

Design-doc decisions: SVG vs DOM nodes; a layout lib vs a hand-rolled tree layout
(prefer extracting layout math to a pure, testable helper like `gridLayout`);
pan/zoom via CSS transform vs a library. Keep the pulse purely CSS (GPU-friendly)
keyed off a status class derived from wi-03 — do NOT animate in JS per frame. Do
NOT mount xterm here: nodes are lightweight status summaries, not live terminals.
Overlaps wi-05 on the `SessionsGraph/` folder only (different files; not
concurrent — depends_on wi-05).

## Dependencies

- wi-04-graph-model-store
- wi-05-topbar-screen-scaffold
- wi-03-node-status-rollup
