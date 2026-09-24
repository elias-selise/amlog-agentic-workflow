## amlog agent routing

> Managed by `amlog` (install / update / uninstall rewrite this section). Don't edit it by hand. Settings live in `amlog-workflow.config.json`.

Users describe the task, not the agent. You pick the agent. Don't wait for the user to name one.

### Routing rules
1. Before you start on a request, check it against the routing table below. If a row matches what the user wants, delegate to that agent straight away and don't do the agent's work yourself. Open with one line: `→ Routing to <agent> (<type>): <why>`.
2. **Pick the stack.** For `fe` vs `be`, go by the paths the task touches (`zones` in `amlog-workflow.config.json`), the issue's labels, or the code itself (`package.json` with Angular/React means `fe`, `*.csproj` means `be`). If it touches both, route to both agents of that stage. If you can't tell, ask one short question.
3. **Resume mid-cycle.** If the request names an issue that already has a `docs/<issue-number>/` folder, continue from where its files leave off:
   - no `instructions.md`: `github-manager-amlog` (start work)
   - no `plan.md`: `planner-amlog`
   - a plan but no code changes on the branch: `implementor-amlog`
   - code changes present: the verification step the user asks for
4. **Plan before code.** A request to build or change a feature goes to `planner-amlog` first unless a confirmed `docs/<issue-number>/plan.md` already exists. Don't send it straight to `implementor-amlog`.
5. **Everything else stays with you.** If no row matches (a general question, explaining code, a one-line tweak the user wants done directly), answer normally without an agent. If the user names an agent explicitly, use that agent.
6. **How to invoke.** Use your tool's subagent mechanism with the agent id from the table. An agent that exists for more than one role gets a `--<type>` suffix, so `implementor-amlog (be)` is `implementor-amlog--be`. If your tool can't run subagents, read the agent's definition file (listed below the table) and follow it as that agent for the rest of the task.

### Handoffs between agents
- An agent that finishes with `NEXT AGENT: <agent> (<type>) — <reason>` lines has handed the next step to you. Before invoking that agent, apply `.amlog/skills/handoff-protocol/SKILL.md`. It covers the loop guard (the same handoff for the same issue `max_handoff_repeats` times, default 3, means stop and ask a human) and the `auto_handover` setting in `amlog-workflow.config.json` (`true` means hand off immediately, `false` or unset means ask the user first). When you have a shell, `amlog handoff check` makes that decision for you.
- An agent that finishes with `HUMAN INPUT REQUIRED: <what>` is waiting on a mandatory human step, such as confirming the AC, writing the instructions file, reviewing the plan, checking the UI visually, or supplying tester edge cases. Pass it to the user word for word and wait, even when `auto_handover` is `true`. Then send the user's answer back to the same agent.

### Routing table
{{ROUTING_TABLE}}

{{DEFINITION_FILES}}
