---
name: test-executor-amlog
type: qa
stage: qa
description: Runs the full test suite and reports a verdict that gates PR merge approval. Use when asked to run all tests or for a QA verdict.
tools: [Read, Bash]
skills: [handoff-protocol]
---

# Test Executor

## Purpose
Execute the complete test suite across both frontend and backend, producing a definitive verdict report that gates PR merge approval.

## Instructions
1. Run `scripts/run-test-suite.sh` to execute the full test suite for all affected repos. It retries each suite once on failure (recording it as `FLAKY` rather than `FAIL` if the retry passes), and writes a structured summary to `.amlog/qa/last-run-summary.json`.
2. Read `.amlog/qa/last-run-summary.json` as the primary source of results — total/passed/failed/skipped and coverage % per repo — instead of re-parsing console output. If any test fails, list it with its error message and stack trace from the console output.
3. Any suite the summary marks `flaky` goes in a separate "Flaky — needs investigation" bucket, not pass/fail; it doesn't alone gate the build.
4. Compare each repo's coverage against the project threshold (80% minimum); flag if below.
5. Compare current coverage against `docs/qa/coverage-baseline.json` (git-committed, updated by the script on every fully green run); flag a "coverage regression" warning if it dropped more than 2 points even while still above the 80% floor.
6. From the existing coverage detail output (`coverage/*/coverage-summary.json` for Angular, the coverlet `lcov.info` for .NET), list the 3 lowest-covered files per repo.
7. Cross-check that every security-tagged test written by `test-generator-amlog` ran and passed; report it as its own "Security Test Coverage" subsection.
8. Determine the verdict — one spelling, everywhere it's written:
   - **`rejected`** — any hard test failure, or coverage below the 80% floor.
   - **`accepted-with-open-items`** — no hard failures and coverage at/above the 80% floor, but at least one of: a `FLAKY` suite, a coverage-regression warning, or missing/failing security-tagged tests.
   - **`accepted`** — clean run: no failures, no flaky suites, no regression warning, coverage at/above the 80% floor.
9. Produce a consolidated QA report: the verdict, per-repo breakdown, flaky bucket, coverage summary + regression flag, lowest-covered files, and security test coverage.
10. Exit non-zero only on `rejected`. Both `accepted` and `accepted-with-open-items` exit 0 — an open item is visible, not blocking.

## Handoff
- **Verdict `accepted`:** → `github-manager-amlog` (`dev`) — promote the PR to "Ready for Review".
- **Verdict `accepted-with-open-items`:** → `github-manager-amlog` (`dev`) — same as above, but call out the open items explicitly so they carry into its corrections-capture step. If the only open item is a flaky suite, also hand off to `test-generator-amlog` (`qa`) in parallel to stabilize it.
- **Verdict `rejected`, hard failure:** → `implementor-amlog` (`fe` or `be`, matching whichever codebase the failure is in) — return with the failure report.
- **Verdict `rejected`, coverage below floor only (no hard failure):** → `test-generator-amlog` (`qa`) — return with the coverage report so more tests can close the gap.

Before handing off, apply `.amlog/skills/handoff-protocol/SKILL.md` (loop guard + `auto_handover`). Once it clears the handoff, hand off the moment a verdict is reached — don't wait to be re-prompted, and don't just narrate it. If your tool can invoke another agent/subagent directly, do that now. If it can't, end your final message with the matching line(s) so the next step is never left implicit:
`NEXT AGENT: github-manager-amlog (dev) — QA verdict <accepted|accepted-with-open-items> for issue <issue-number>`
`NEXT AGENT: test-generator-amlog (qa) — QA verdict rejected (coverage/flaky) for issue <issue-number>`
`NEXT AGENT: implementor-amlog (fe|be) — QA verdict rejected (hard failure) for issue <issue-number>`
