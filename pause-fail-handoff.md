# Pause/Resume Failure — Handoff

## What happened

During a session-limit scare we paused all running agent sessions, then resumed
them a short time later to check their state. **Resuming killed them.** All 7
`claude` TUI processes across 4 workspaces exited, leaving their shells back at
empty prompts. The in-memory conversation state was lost.

Sessions affected at the time:
- `/home/ruben/dev/itris-mechsuit` — 4 sessions (one mid-"thinking", one running
  stop hooks, one idle/awaiting input, one improvising)
- `/home/ruben/dev/agentic-ai` — 1 session
- `/home/ruben/dev/specsmd_new` — 1 session
- `/home/ruben/dev/aai` — 1 session

## Root cause (my take)

`pause_sessions` / `resume_sessions` operate by raw OS process suspension:
- **Pause** = `SIGSTOP` (or equivalent) on the `claude` process. This is why it
  was reported as safe and reversible — the process is frozen in place, no state
  is discarded.
- **Resume** = `SIGCONT`.

The problem is the lifecycle of a **foreground TUI job** under a shell:

1. When `claude` (a full-screen TUI on the alternate screen buffer) is `SIGSTOP`ed,
   the shell's job control marks it `[1]+ Stopped` and the shell reclaims the
   terminal foreground, redrawing its own prompt.
2. `SIGCONT` continues the process, **but it does not restore the job to the
   terminal foreground.** The TUI resumes as a background job.
3. A backgrounded TUI that tries to read from / write to the controlling
   terminal receives `SIGTTIN` / `SIGTTOU`, and/or the terminal state it
   assumed (alternate screen, cursor mode, raw input) no longer holds.
4. The net result on this run: the TUIs did not reattach and the processes
   exited. The scrollback shows each session ending in repeated bare shell
   prompts with screen-clear sequences (`ESC[H ESC[2J`) after the
   `[1]+ Stopped claude` line — i.e. the shell took over and the agent is gone.

So: **pausing is safe; resuming a foreground TUI job via SIGCONT is not** — it
does not cleanly restore the terminal foreground, and the agent dies.

## Evidence

Reading the session scrollback after resume showed, for every session, a tail of:

```
[1]+  Stopped                 claude
ruben@host:~/dev/mechsuit$ <screen-clear> ruben@...$ ...
```

No post-resume TUI render frames ever appeared — only shell prompt redraws.

## Direction for whoever fixes this

Raw `SIGSTOP`/`SIGCONT` on a foreground TUI is the wrong primitive. Options worth
exploring (non-exhaustive):
- Bring the job back to the foreground on resume (`fg` semantics / give the job
  the controlling terminal again) before/after `SIGCONT`, rather than leaving it
  backgrounded.
- Run agents detached under a proper session/pty multiplexer so suspend/resume
  doesn't fight the shell's job control.
- Replace "freeze the CPU" with a graceful checkpoint: signal each agent to wrap
  up / reach a safe idle point (e.g. via `send_to_session`) before suspending,
  so a lost process is recoverable.

---

**Note:** The above is *my* analysis of what likely went wrong. The agent picking
this up to resolve it **must talk to Ruben first** before designing a fix — he
has hit similar issues elsewhere and already has a solution in mind. His view is
that this should **not** be a CPU-level stop (SIGSTOP); there is another, better
way to do this that he wants to walk through directly. Do not implement a fix
without that conversation.
