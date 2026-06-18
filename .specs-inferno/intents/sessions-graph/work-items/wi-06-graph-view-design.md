---
work_item: wi-06-graph-view
intent: sessions-graph
created: 2026-06-17
mode: autopilot
checkpoint_1: approved
---

# Design: Graph view — layout, pan/zoom, icons, pulse

## Summary

Render the wi-04 tree as an always-expanded tiered node graph inside the wi-05
container: DOM nodes plus an SVG edge layer, CSS-transform pan/zoom, a pure
tiered-layout helper (`src/lib/graphLayout.ts`, testable like `gridLayout`), and a
pure-CSS four-state pulse keyed off wi-03's status class. Nodes are lightweight
status summaries (icon + label + pulse) — no xterm is mounted here.

## Scope

**In Scope:**
- A pure layout helper that turns the wi-04 tree into positioned nodes + edges.
- `GraphCanvas` (pan/zoom + render) and `GraphNode` (icon/label/pulse) components.
- Inline-SVG icon set per node kind; CSS keyframe pulses for the four states.
- A stable per-node handle/prop so wi-07 can attach actions.

**Out of Scope:**
- Node interactions beyond pan/zoom — click/navigate/pause/kill are wi-07.
- The data assembly (wi-04), the status/pulse logic (wi-03), the screen container + toggle (wi-05).
- Virtualization / a graph library (noted as a future option, not v1).

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Render tech | DOM nodes (absolutely positioned) + SVG layer for connectors | DOM gives easy icons/labels/a11y and event handles for wi-07; SVG only draws edges |
| Layout | Hand-rolled top-down tiered tree layout extracted to pure `src/lib/graphLayout.ts` | Deterministic and unit-testable (like `gridLayout`); tree is shallow (≤4 tiers) |
| No external graph lib | No react-flow / d3-hierarchy in v1 | Shallow tree + CSS transform suffices; keeps the bundle lean; revisit only if scale demands |
| Pan/zoom | CSS `transform: translate()+scale()` on a single inner layer; wheel = zoom, drag = pan; clamp scale | GPU-composited, smooth at scale, no per-frame JS, no relayout on pan |
| Pulse animation | Pure CSS `@keyframes` per color class (green/orange/red pulse; gray static); class from wi-03 `pulseFor` | Constraint: GPU-friendly, no JS animation; status→visual stays centralized in wi-03 |
| Icons | Inline SVG per kind (repo, worktree=branch, terminal, subagent=spark) | Matches TitleBar's inline-SVG convention; no icon-font dependency |
| Node content | icon + label + status pulse only — no xterm mount | It is a map, not live panes; performance |

## Data Models Affected

### Creates
- **GraphLayout** (value type, in `graphLayout.ts`): positioned nodes (`{ node, x, y, tier }`) + edges (`{ fromId, toId }`) - the pure layout result the canvas renders.

(No backend or store models; consumes the wi-04 tree + wi-03 descriptors.)

## Technical Approach

### Architecture

```
SessionsGraph  (wi-05 container, mounts the canvas in its slot)
  └─ GraphCanvas            subscribes graphStore (wi-04); owns pan/zoom transform
       ├─ graphLayout(tree)  → { nodes:[{node,x,y,tier}], edges:[{from,to}] }   (pure lib, tested)
       ├─ <svg> edge layer   → draws connectors between positioned nodes
       └─ GraphNode × N      → icon(kind) + label + pulse class from pulseFor(status)
                               exposes a stable handle/prop for wi-07 actions
```

### Data Flow
- `graphStore` (wi-04) → tree → `graphLayout()` (memoized on tree identity) → positioned nodes/edges → render. Pan/zoom mutates only the CSS transform, never the layout.

## Dependencies

- wi-04-graph-model-store (the tree)
- wi-05-topbar-screen-scaffold (the container to mount into)
- wi-03-node-status-rollup (pulse descriptors)

## Execution Assumptions

wi-06 owns `GraphCanvas.tsx`, `GraphNode.tsx`, their tests, and the component CSS,
**plus the new pure helper `src/lib/graphLayout.ts` (+ test)** — added to the work
item's ownership. It mounts into wi-05's `SessionsGraph` container slot (overlap on
the `SessionsGraph/` folder is non-concurrent — wi-06 depends_on wi-05). wi-07 later
attaches actions to `GraphNode` (serialized after wi-06).

## Affected Files

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/graphLayout.ts` | create | Pure tiered tree → positioned nodes + edges |
| `src/lib/graphLayout.test.ts` | create | Layout unit tests (representative trees) |
| `src/components/SessionsGraph/GraphCanvas.tsx` | create | Subscribe store, layout, render edges+nodes, pan/zoom |
| `src/components/SessionsGraph/GraphNode.tsx` | create | Node: icon + label + pulse class; handle for wi-07 |
| `src/components/SessionsGraph/*.css` | create | Keyframe pulses + node/edge styling |
| `src/components/SessionsGraph/GraphCanvas.test.tsx` | create | Render tests |
| `src/components/SessionsGraph/GraphNode.test.tsx` | create | Node render + status→pulse mapping tests |

## Integration Points

| System | Type | Purpose |
|--------|------|---------|
| graphStore (wi-04) | store subscription | The tree to render |
| nodeStatus (wi-03) | pure import | `pulseFor` color + pulsing flag |
| SessionsGraph container (wi-05) | mount slot | Where the canvas renders |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Many nodes → layout/render cost | medium | Pure layout memoized on tree identity; CSS-transform pan/zoom (no relayout on pan); virtualize later only if needed |
| Pulse on many nodes → repaint | medium | Animate only compositor-friendly props (transform/opacity/box-shadow); pulse class capped by status |
| Hand-rolled layout edge cases (deep/wide trees) | low | Pure-function tests for representative trees; tiered layout is simple |
| Aesthetic quality (the "cool icons + beautiful pulse" bar) | low | Inline-SVG icon set + pulse curves reviewed at build; the frontend design skill applies here |

## Implementation Checklist

- [ ] `src/lib/graphLayout.ts` + test: pure tiered layout (tree → positioned nodes + edges)
- [ ] `GraphCanvas.tsx`: subscribe graphStore, compute layout, render SVG edges + DOM nodes
- [ ] Pan/zoom: CSS transform layer, wheel-zoom + drag-pan, clamped scale
- [ ] `GraphNode.tsx`: icon per kind + label + status pulse class (`pulseFor`); stable handle/prop for wi-07
- [ ] CSS `@keyframes` pulses (green/orange/red) + gray static; node + edge styling
- [ ] Inline SVG icon set (repo / worktree / terminal / subagent)
- [ ] Render tests: node renders, status→pulse class mapping, layout snapshot
- [ ] `npm test` + `npm run build` green

---
*Generated by specs.md INFERNO Flow | Checkpoint 1 approved: 2026-06-17*
