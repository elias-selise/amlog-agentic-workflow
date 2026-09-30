---
name: handoff-protocol
description: Shared rules for passing work from one amlog agent to another. Covers the loop guard (the same handoff for the same issue 3 times goes to a human), the auto_handover setting, and the mandatory human gates that always apply.
---

# Handoff Protocol

This is a process skill. It describes how agents coordinate, not how the codebase looks, so don't edit it when the codebase changes.

**Who applies it:** the one who actually starts the next agent. If you can invoke another agent or subagent yourself, that's you. If you can't, for example because you are a subagent that can only return a result, the orchestrating session applies it when it reads your `NEXT AGENT:` line. In that case, don't check or record anything yourself: only one party records each handoff, so it's never counted twice.

## 1. Settings

Read `amlog-workflow.config.json` at the workspace root. If the file or a key is missing, use the default.

| Key | Default | Meaning |
|---|---|---|
| `auto_handover` | `false` | `true`: hand off without asking. `false`: ask the user to confirm each handoff. |
| `max_handoff_repeats` | `3` | How many times the same handoff (same from-agent, same to-agent, same issue) can happen before a human must step in. |

## 2. Loop guard (always on)

- **Issue key:** the GitHub issue number. Before an issue exists (the BA stage), use the story file name.
- **Log:** `.amlog/handoffs/<issue-key>.log` holds one line per handoff:
  `<ISO-8601 time> | <from-agent> (<type>) -> <to-agent> (<type>) | <reason>`

Before every handoff, get a decision:

- **With a shell:** run `amlog handoff check --issue <key> --from <from-agent>/<type> --to <to-agent>/<type>`. It prints `DECISION: PROCEED`, `CONFIRM` or `ASK_HUMAN`, plus the earlier attempts.
- **Without a shell, or if `amlog` isn't on PATH:** read the log yourself. Count the lines with the same `from -> to` pair that come after the last line for that pair whose reason starts with `[human-approved]` or `[reset]` (a `* -> *` reset line counts for every pair). If `count + 1 >= max_handoff_repeats`, the decision is `ASK_HUMAN`. Otherwise it is `PROCEED` when `auto_handover` is `true` and `CONFIRM` when it is `false`.

What each decision means:

- **`ASK_HUMAN` (loop limit):** don't hand off, even when `auto_handover` is `true`. List the earlier attempts from the log so the human can see what keeps coming back, then end with:
  `HUMAN INPUT REQUIRED: loop limit — <from> -> <to> for issue <key> would be attempt <n>. <one line on what keeps failing>. Reply "continue" to hand off again, or say what to change.`
  If the human replies "continue", record the handoff with `--human-approved`, which restarts the count for that pair, then hand off. If they give other direction, follow it instead.
- **`PROCEED`:** record the handoff, then hand off right away. Don't ask "shall I continue?".
- **`CONFIRM`:** ask one question: `Hand off to <agent> (<type>) to <reason>? (yes / no)`. Wait for the answer. On yes, record and hand off. On no, stop, and leave the `NEXT AGENT:` line in your message so the user can resume later.

**Recording** happens right before you invoke the next agent. Run `amlog handoff record --issue <key> --from <from>/<type> --to <to>/<type> --reason "<short reason>"` (add `--human-approved` after a loop-limit approval), or append the log line yourself if you have no shell.

If there are parallel handoffs (two `NEXT AGENT:` lines from one trigger), check and record each one separately.

`amlog handoff status --issue <key>` shows the current count for every pair.

## 3. Mandatory human gates (never skipped, even with `auto_handover: true`)

| Gate | Agent | What it waits for |
|---|---|---|
| AC + story confirmation | `story-writer-amlog` | Explicit approval of the AC and story description |
| Instructions file | `github-manager-amlog` (start of work) | The developer's technical details for `docs/<issue-number>/instructions.md` |
| Plan review | `planner-amlog` (fe/be) | The developer's approval of `docs/<issue-number>/plan.md` |
| Visual verification | `browser-launcher-amlog` | The human's visual check of the implemented UI (screenshots or the running app) |
| Test cases | `test-generator-amlog` | The tester's own edge and corner cases |
| Commit / PR | `github-manager-amlog` | Approval of the commit message, and confirmation of the PR source and target branches |
| Loop limit | any agent | See `ASK_HUMAN` above |

At a gate, end your message with `HUMAN INPUT REQUIRED: <gate> — <exactly what you need>` and wait. An approval at a gate also counts as the confirmation for the handoff right after it, so with `auto_handover: false` don't ask a second "hand off?" question. Just record and hand off.

`auto_handover` only removes the confirmation step between agents. It never removes a gate from this table.

## 4. Final-message lines

Put these as the last lines of your final message, one per line:
- `NEXT AGENT: <agent> (<type>) — <reason>` for each handoff you didn't perform yourself.
- `HUMAN INPUT REQUIRED: <what>` when you're stopped at a gate or at the loop limit. Don't add a `NEXT AGENT:` line for a step that is still waiting on a human.
