---
work_item: wi-02-subagent-detection
intent: sessions-graph
created: 2026-06-17
revised: 2026-06-17
mode: autopilot
checkpoint_1: approved
---

# Design: Subagent detection from the PTY output stream

> **Revised 2026-06-17 (per user direction):** the original design correlated each
> PTY to a Claude transcript on disk (`~/.claude/projects/<encoded-cwd>/*.jsonl`,
> `isSidechain`). That approach carried a real ambiguity — multiple sessions in one
> cwd (exactly the INFERNO case, where builders share one intent worktree) could
> not be disambiguated without a per-session spawn timestamp. The PTY output stream
> is **already keyed by sessionId**, so reading subagents from the terminal stream
> the status engine already consumes makes attribution exact and deletes the entire
> backend subsystem. This document describes that PTY-stream design.

## Summary

Detect Claude Code subagents per live session directly from the PTY output stream
(`session://output`) that the status engine already consumes. A pure parser
(`src/lib/subagentParser.ts`, mirroring `statusParser.ts`) recognizes Claude Code's
Task/subagent render markers in ANSI-stripped output; a sibling engine
(`src/state/subagentEngine.ts`, mirroring `statusEngine.ts`) owns a single
`session://output` / `session://exit` subscription and accumulates each session's
live one-level subagent list into a passive `subagentStore` keyed by sessionId.
No backend, no transcript files, no new Tauri event. Attribution is exact because
the stream is keyed by sessionId.

## Scope

**In Scope:**
- A pure parser that recognizes Task/subagent markers in ANSI-stripped output and classifies running / done / failed.
- A sibling engine: single subscription, per-session accumulation over a bounded tail, status derivation, clear-on-exit; started by the graph liveness layer (wi-04).
- A passive `subagentStore` keyed by sessionId; the `SubagentNode` TS type.

**Out of Scope:**
- Any backend / Rust, transcript-file reading, or new Tauri event (all removed vs the prior design).
- Deep recursion (`subagent → subagent → …`) — not observable from a parent terminal; one level only.
- Roll-up / graph assembly (wi-04); pulse descriptors / render (wi-03 / wi-06).

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Source of truth | Parse the live PTY output stream (`session://output`), NOT transcript files | The stream is already captured + ANSI-parsed by `statusEngine` and is keyed by sessionId, so attribution is exact even when sessions share a cwd / intent worktree — the prior approach's core ambiguity disappears |
| Location | Frontend only (parser + engine + store), mirroring `statusParser` / `statusEngine` / `statusStore` | Reuses the established pure-parser / subscription-engine / passive-store split; no Rust subsystem, no new event, no filesystem or privacy surface |
| Subscription | A sibling engine with its OWN `session://output` listener | `Terminal.tsx` and `statusEngine` already multi-subscribe to the stream; keeps subagent derivation independent of status derivation with the same teardown lifecycle |
| Depth | One level (a session → its direct subagents) | A parent terminal never renders a subagent's own subagents (they run in an isolated context), and this matches the intent's `session → subagent` model exactly |
| Subagent status | Map Task render state → `SessionStatus`: running→`working`, done→`ready`, failed→`error` | Reuses the four-state model; `awaiting-approval` is a main-session state, not a subagent state |
| Label | The Task `subagent_type` / description when the render exposes it, else `"subagent"` | Human-meaningful, taken only from what the TUI already prints |
| Lifecycle owner | `startSubagentEngine()` started by wi-04's graph liveness layer; also export `<SubagentEngine/>` for parity | Subagents are only shown in the graph; no always-on parsing cost when the graph is closed |
| Privacy | Store only structural facts (a subagent exists, its type label, its coarse state) | Same boundary as before, now trivially satisfied — we read only already-rendered markers and never persist message text |

## Data Models Affected

### Creates
- **SubagentNode** (TS, in `src/types/index.ts`): `id: string`, `label: string`, `status: SessionStatus` — one subagent of a session. Flat for v1 (one level); wi-04 nests these under their session node.
- **subagentStore** state: `Record<string /* sessionId */, SubagentNode[]>` with `set(sessionId, nodes)` / `clear(sessionId)` actions.

(No backend or event-payload models — the prior `SubagentsUpdate` event is removed.)

## Technical Approach

### Architecture

```
session://output  (sessionId, data)  ── already powers statusEngine ──┐
                                                                       ▼
subagentEngine  (one subscription, like statusEngine)
   stripAnsi(tail) + subagentParser(tail)  → detect Task start / done / fail
   accumulate per sessionId → SubagentNode[]   (bounded trailing buffer)
   write subagentStore.set(sessionId, nodes);  clear(sessionId) on session://exit
                                                                       ▼
subagentStore (passive, keyed by sessionId)  ──►  graphStore (wi-04)  ──►  graph (wi-06)
```

### Data Flow
- Same stream as status. `subagentParser` is pure (no timers/IO). The engine accumulates per session over a bounded tail and writes the store. The store is passive. wi-04 reads `subagentStore` and starts the engine while the graph is live.

## Dependencies

- (none — independent frontend data source; consumed by, and started by, wi-04's graph liveness layer)

## Execution Assumptions

No backend change is required. wi-02 owns `subagentParser` (+test),
`subagentEngine` (+test), `subagentStore` (+test), and adds `SubagentNode` to
`src/types/index.ts` (the ONLY overlap with wi-01 — serialized by the
orchestrator). The engine is mounted by wi-04 via `startSubagentEngine()`; wi-04
already `depends_on` wi-02.

## Affected Files

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/subagentParser.ts` | create | Pure: recognize Task/subagent markers in ANSI-stripped output; classify running/done/failed |
| `src/lib/subagentParser.test.ts` | create | Parser tests incl. plain-shell / ANSI noise → no subagents |
| `src/state/subagentEngine.ts` | create | Single `session://output`/`exit` subscription; per-session accumulation; `startSubagentEngine()` + `<SubagentEngine/>` |
| `src/state/subagentEngine.test.ts` | create | Engine tests: synthetic output → store updates; clear on exit; teardown |
| `src/state/subagentStore.ts` | create | Passive zustand store keyed by sessionId |
| `src/state/subagentStore.test.ts` | create | Store action tests |
| `src/types/index.ts` | modify | Add `SubagentNode` |

## Security Considerations

- **No transcript / filesystem access at all** — the prior design's `~/.claude/projects` read is removed.
- **No message-text exposure** — we read only the structural Task markers Claude Code already renders to the terminal and store only `{ id, label, status }`; prompts, tool arguments, and message bodies never enter the store.

## Integration Points

| System | Type | Purpose |
|--------|------|---------|
| `session://output` / `session://exit` | event subscription | The live stream subagents are derived from |
| `statusParser` / `statusEngine` / `statusStore` | pattern to mirror | Pure parser / subscription engine / passive store |
| `graphStore` (wi-04) | store read + `startSubagentEngine` | Consumer + lifecycle owner |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude Code TUI rendering changes across versions | medium | Same risk class as `statusParser` (which already matches Claude menus); keep the regex set small + commented; unknown render → no subagents (graceful) |
| Coarse subagent status (running/done mainly) | low | Map to `working`/`ready`/`error`; document that `awaiting-approval` is a main-session state |
| Two listeners on a high-volume stream | low | Already the norm (`Terminal.tsx` + `statusEngine`); parse a bounded trailing buffer like `statusEngine`, never the whole stream |
| A subagent that started AND finished before the graph opened is missed | low | Live view only — finished work isn't live; acceptable for v1 |

## Implementation Checklist

- [ ] `SubagentNode` type (`types/index.ts`)
- [ ] `subagentParser.ts`: `stripAnsi` + small commented markers for Task start/done/fail; pure; degrade gracefully
- [ ] `subagentStore.ts`: passive store keyed by sessionId (`set` / `clear`)
- [ ] `subagentEngine.ts`: one `session://output`/`exit` subscription, per-session accumulation over a bounded tail, clear on exit; `startSubagentEngine()` + `<SubagentEngine/>`
- [ ] Tests: parser (incl. plain-shell → none), store actions, engine (synthetic output → store, clear on exit)
- [ ] `npm test` + `npm run build` green

---
*Generated by specs.md INFERNO Flow | Revised 2026-06-17 (PTY-stream attribution replaces transcript correlation) | Checkpoint 1 approved*
