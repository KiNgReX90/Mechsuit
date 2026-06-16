# FIRE Flow

**Fast Intent-Run Engineering** — A simplified AI-native development methodology.

For getting started, see [quick-start.md](./quick-start.md).

## Summary

- **Hierarchy**: Intent → Work Item → Run
- **Checkpoints**: 0-2 (adaptive based on complexity)
- **Agents**: Orchestrator, Planner, Builder

## Commands

| Command | Purpose |
|---------|---------|
| `/specsmd-fire` | Main entry point (orchestrator) |
| `/specsmd-fire-planner` | Planning and decomposition |
| `/specsmd-fire-builder` | Execution and walkthroughs |

## Team Track (parallel execution)

The team track runs multiple builder subagents in parallel inside ONE intent worktree, with dependency-aware dispatch and an orchestrator-verified merge gate. It coexists with the standard sequential track — both operate on `.specs-fire/`.

| Command | Agent | Purpose |
|---------|-------|---------|
| `/specsmd-fire-team` | `agents/team/agent.md` | Orchestrator: intent selection, claim, worktree, frontier dispatch, serialized integration, finalize |
| `/specsmd-fire-team-planner` | `agents/team-planner/agent.md` | Captures intents; decomposes into team-compatible work items (`depends_on`, `context.required`, `ownership.editable`) |
| `/specsmd-fire-team-builder` | `agents/team-builder/agent.md` | Executes exactly one assigned work item; dispatched as a subagent by the orchestrator |
| `/specsmd-fire-team-config` | — | Creates `.specs-fire/config.yaml` (worker model tiers, finalize verification commands) |

Team work items always execute in **autopilot** — builders are parallel subagents and cannot pause for confirm/validate checkpoints; oversight happens at planning time and at the orchestrator's verified finalize. Per-project tuning lives in the optional `.specs-fire/config.yaml` (template: `agents/team/config.example.yaml`). The sequential track is claim-unaware, so do not run `/specsmd-fire` and `/specsmd-fire-team` concurrently on the same intent.
