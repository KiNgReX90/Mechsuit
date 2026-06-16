---
id: usage-meter
title: Usage Meter — Subscription 5-Hour & Weekly Limit Bar
status: pending
created: 2026-06-16T14:36:19Z
---

# Intent: Usage Meter — Subscription 5-Hour & Weekly Limit Bar

## Goal

Add a slim **usage meter** along the **bottom of the mechsuit window** that shows, at a
glance, how much of the user's Claude subscription limits is consumed and when each window
resets — both the **5-hour rolling window** and the **7-day weekly window**. Each window
renders as a small progress bar + percent + a reset countdown:

```
5h ▓▓▓▓▓░░░░░ 49% · resets 2h13m    wk ▓▓▓░░░░░░░ 31% · 6d
```

The data is read **directly from a structured HTTP endpoint** the Claude Code client already
uses — **no terminal, no screen-scraping, no spawned `claude` process**. The Rust backend reads
the user's existing subscription OAuth token from `~/.claude/.credentials.json` and polls:

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <accessToken>
anthropic-beta: oauth-2025-04-20
```

which returns exactly the needed shape:

```json
{
  "five_hour": { "utilization": 49.0, "resets_at": "2026-06-16T18:29:59.389613+00:00" },
  "seven_day": { "utilization": 31.0, "resets_at": "2026-06-22T19:59:59.389642+00:00" }
}
```

The backend polls roughly **every 60s**, emits the snapshot to the frontend over a Tauri event,
and the footer renders it. When the endpoint, token, or network is unavailable, the meter
degrades gracefully to a muted **"usage unavailable"** state rather than erroring.

## Users

The developer running mechsuit who is on a **Claude subscription (Pro/Max/Team)** and burns
through the 5-hour and weekly rate-limit windows while supervising many agent sessions. They
want a passive, always-visible readout of how close they are to a limit and when it resets —
without opening a terminal and running `/usage` interactively.

## Problem

Today the only way to see subscription usage is to open Claude Code and run the interactive
`/usage` TUI in a session. That interrupts flow, only shows a point-in-time snapshot, and is
invisible while the user is working across many tiled sessions. There is no ambient,
always-on indicator of how much 5-hour / weekly credit remains or when it resets — so users
hit limits by surprise.

## Success Criteria

- A **slim bar fixed to the bottom of the app window** (spanning the full width, below the
  sidebar + workspace) is always visible.
- It shows **both windows** — 5-hour and weekly — each as a **small progress bar + integer %
  used + a reset countdown** (e.g. `resets 2h13m`, `6d`). Reset time is always shown.
- **Color thresholds:** each bar/value shifts **green → amber → red** as utilization climbs
  (amber at ≥75%, red at ≥90%), so high usage is obvious at a glance.
- Data comes from the **`oauth/usage` HTTP endpoint** using the **existing on-disk OAuth
  token** — mechsuit holds **no API key**, prompts for nothing, and incurs **no extra cost**.
- The backend **polls ~every 60s** and pushes updates to the UI via a Tauri event
  (`usage://updated`); the bar also primes itself once on mount via a `get_usage` command so
  it isn't blank for up to a minute.
- **Graceful degradation:** missing/expired token, non-200 response, network failure, or an
  unexpected JSON shape produce a muted **"usage unavailable"** state — never a crash, never a
  blocking error dialog.
- The token is **read fresh from disk on each poll** (not cached in memory), so when Claude
  Code refreshes it on disk the meter picks up the new token on the next tick.
- The token is sent **only** to `api.anthropic.com` over HTTPS (the same destination Claude
  Code already uses) and is **never logged** or sent anywhere else.

## Constraints

- **Builds on `foundation-terminal-grid`:** reuses the Tauri command/event IPC contract
  pattern (Rust `events.rs` constants + camelCase serde payloads mirrored in `src/types`,
  `src/ipc/commands.ts`, `src/ipc/events.ts`), the `App.tsx` app-shell layout, the zustand
  store convention (`src/state/*Store.ts`), and the pure-util + Vitest convention
  (`src/lib/*.ts` like `relativeTime.ts`).
- **Undocumented endpoint (accepted risk):** `GET /api/oauth/usage` is not officially
  documented; it is the same call the Claude Code client makes and was verified returning live
  data on this machine (2026-06-16). The design **must** tolerate it changing or disappearing
  via the "unavailable" fallback. No official/stable alternative exists for individual
  subscription limits (the Admin Usage/Cost APIs are org-level and require an admin key).
- **No new auth, no API key, no cost:** uses the subscription OAuth token already present at
  `~/.claude/.credentials.json` (verified: `accessToken` + `refreshToken` present, valid). The
  user's decision: *if the credential is already there at no extra cost, use the endpoint* — it
  is, so we do. mechsuit does **not** implement OAuth refresh (Claude Code refreshes the
  on-disk token itself); an expired token simply yields "unavailable" until refreshed.
- **HTTP client:** `reqwest` is already in the dependency tree (via `rmcp`) but without a TLS
  backend. Add it as a direct dependency with `rustls-tls` + `json` features enabled (rustls
  avoids a system OpenSSL dependency, better for portability). Run the fetch on the existing
  tokio runtime.
- **No date crate needed:** `resetsAt` is passed through to the frontend as the raw RFC3339
  string from the endpoint; the frontend computes the countdown with native `Date` parsing.
  (`chrono` happens to be in the tree via `rmcp` but is not required here.)
- **IPC contract (fixed shape — both sides implement it independently so they stay parallel):**
  - Event `usage://updated`, payload `UsageUpdate { snapshot: UsageSnapshot | null, error: string | null }`.
  - Command `get_usage() -> Result<UsageSnapshot, String>`.
  - `UsageSnapshot { fiveHour: UsageWindow, sevenDay: UsageWindow }`.
  - `UsageWindow { utilization: number, resetsAt: string /* RFC3339 */ }`.
  - All Rust payload structs serialize **camelCase** (matching the existing models).
- **Testability:** the network GET + credentials-file read are thin I/O wrappers and are not
  unit-tested in CI; the **pure** parts are — parsing the endpoint JSON body into
  `UsageSnapshot` (valid / missing-field / malformed cases) and extracting the token from a
  credentials-JSON string. Mirrors how `piper-tts-backend` gates its I/O test.
- **Platform:** Linux primary (consistent with the rest of the project). Home dir resolved via
  `$HOME` / `dirs`-style lookup (the project already hard-codes `/home/ruben` in places, e.g.
  Commander's spawn cwd — prefer `$HOME` here, fall back consistently).
- **Polling interval** is a named constant (60s) for now; making it user-configurable is
  deferred (a separate settings intent is already in flight).

## Notes

Design agreed via brainstorming + research (2026-06-16):

- **Approach decision (user):** "if it requires a token that isn't already configured and costs
  money, do the background terminal; if it's already there, do that." The credential **is**
  already present at no cost → **HTTP endpoint approach** chosen over the originally-imagined
  background polling PTY that would run `/usage` and screen-scrape the TUI. The endpoint avoids
  fragile ANSI parsing, avoids holding/respawning a `claude` process, and does not itself
  consume usage.
- **Display decisions (user):** show **both** 5-hour and weekly windows; render as **progress
  bar + % + reset countdown**; include **color thresholds**. Deferred this version:
  click-to-refresh-now and an exact-timestamp tooltip.
- **Endpoint findings** (via `claude-code-guide`, 2026-06-16): `/usage` itself is TUI-only with
  no non-interactive equivalent; `claude -p --output-format json` exposes per-turn token/cost
  but **not** rolling-limit state; no on-disk cache of the rolling-limit state exists
  (`~/.claude/stats-cache.json` is historical activity only). The `oauth/usage` endpoint is the
  only structured route to the rolling-limit state for an individual subscriber.

Open items to resolve at decomposition/build:

- Exact `reqwest` feature set + version pin (reuse the in-tree `0.13.x`); confirm `rustls-tls`
  pulls cleanly.
- Whether the poller emits immediately on startup AND the frontend primes via `get_usage` on
  mount (belt-and-suspenders against a mount/emit race) — recommended.
- Color-threshold cutoffs (default amber ≥75%, red ≥90%) — confirm at build; keep as named
  constants.
- `utilization` is a percentage 0–100 (float); decide rounding for display (integer %).
