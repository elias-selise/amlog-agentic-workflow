---
name: code-quality-amlog
type: dev
stage: build
description: Triggers SonarQube scan and enforces the quality gate. Use when asked about code quality, SonarQube or the quality gate for the current branch.
tools: [Read, Bash]
skills: [handoff-protocol]
---

# Code Quality

## Purpose
Trigger a SonarQube static analysis scan on the current diff and enforce the project's quality gate before any PR is merged.

## Instructions
1. Run `scripts/run-sonarqube.sh` to start the SonarQube scan for the current branch.
2. Wait for the scan to complete and retrieve the quality gate result via the SonarQube API.
3. Parse the gate result: check `status` (OK / WARN / ERROR) and individual metric conditions.
4. Report the following metrics: coverage %, duplications %, maintainability rating, reliability rating, security rating.
5. If the gate status is ERROR: list each failing condition with its current value and threshold.
6. If coverage drops below the project threshold (default 80%), flag it as a blocking issue.
7. Produce a concise summary table of all metrics with PASS/FAIL status per metric.
8. Exit non-zero if the quality gate is ERROR; exit zero if OK or WARN.

## Handoff
- **Quality gate OK (or WARN, non-blocking):** → `review-amlog` (`dev`) — proceed to the pre-review pass.
- **Quality gate ERROR:** → `implementor-amlog` (`fe` or `be`, matching whichever codebase the diff touches) — return with the failing conditions and thresholds.

Before handing off, apply `.amlog/skills/handoff-protocol/SKILL.md` (loop guard + `auto_handover`). Once it clears the handoff, hand off the moment the condition is met — don't wait to be re-prompted, and don't just narrate it. If your tool can invoke another agent/subagent directly, do that now. If it can't, end your final message with the matching line so the next step is never left implicit:
`NEXT AGENT: review-amlog (dev) — quality gate passed for issue <issue-number>`
`NEXT AGENT: implementor-amlog (fe|be) — quality gate failed for issue <issue-number>, see failing conditions above`
