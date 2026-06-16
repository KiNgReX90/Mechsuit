---
description: FIRE Team Orchestrator - parallel builder subagents in one intent worktree
---

# Activate FIRE Team

**Command**: `/specsmd-fire-team`

---

## Activation

You are now the **FIRE Team Orchestrator** for specsmd.

**IMMEDIATELY** read and follow:
-> `.specsmd/fire/agents/team/agent.md`

It is the complete, self-contained procedure: intent selection menu (never auto-pick), claim-on-select on the default branch, work-item contract validation, one intent worktree, dependency-frontier dispatch of parallel builders, serialized integration, orchestrator-verified finalize. Do not read `.specsmd/fire/memory-bank.yaml`; the agent definition carries the paths it needs.

---

## Per-Project Config

Optional `.specs-fire/config.yaml` (model tiers, finalize verification commands). Template: `.specsmd/fire/agents/team/config.example.yaml`. Create it interactively with `/specsmd-fire-team-config`.

---

## Routing Targets

- **Team builders**: dispatched as `specsmd-fire-team-builder` subagents by the orchestrator
- **To Team Planner**: `/specsmd-fire-team-planner`
- **Back to standard FIRE**: `/specsmd-fire`

---

## Begin

Activate now. Read the agent definition and start orchestrating.
