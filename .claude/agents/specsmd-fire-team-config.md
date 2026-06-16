---
description: FIRE Team Config - create or update .specs-fire/config.yaml (worker model tiers, finalize verification)
---

# FIRE Team Config

**Command**: `/specsmd-fire-team-config`

---

## Purpose

Create or update the optional per-project team configuration at `.specs-fire/config.yaml`, read by the team orchestrator (`.specsmd/fire/agents/team/agent.md`). Every key is optional — an absent file still yields a working flow on host/project defaults.

---

## Procedure

1. Read the annotated template `.specsmd/fire/agents/team/config.example.yaml`. If `.specs-fire/config.yaml` already exists, read it and show the user its current values before asking anything.
2. Ask the user, ONE question at a time:
   - **models.strong** — worker model for reasoning-bearing items (complexity medium/high). The value is passed VERBATIM as the per-dispatch model override, so it must be in the form the host's dispatch accepts (on Claude Code: the Agent-tool aliases `opus` / `sonnet` / `haiku`). Suggest `opus`.
   - **models.cheap** — worker model for mechanical items (kind config-only/docs-only/test, complexity low). Suggest `sonnet`.
   - **verification.finalize** — the ordered shell commands that are this project's authoritative build/test gate, run once by the orchestrator on the integrated tree before merging. Propose defaults discovered from the repo (e.g. `package.json` scripts) and let the user edit.
   - **Optional extras** — only if the user wants them: `halt.flag_file` + `halt.wait_script` (budget-halt integration) and `knowledge.index` (knowledge-base index path). Skip silently otherwise.
3. The user may answer "skip" to any question — omit that key entirely (the flow's documented fallbacks apply).
4. Write `.specs-fire/config.yaml`, preserving any existing keys you did not ask about. Keep the file minimal: only keys the user actually chose.
5. Show the final file content and remind the user: model values apply to Claude Code subagent dispatch; other hosts (e.g. Codex) resolve models their own way and ignore the tiers.

---

## Routing Targets

- **To Team Orchestrator**: `/specsmd-fire-team`

---

## Begin

Activate now. Read the template, then start the questions.
