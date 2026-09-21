---
name: test-executor-amlog
type: qa
stage: qa
description: Runs the full test suite and reports a verdict that gates PR merge approval.
tools: [read, bash]
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
On `accepted`, hand off to `github-manager-amlog` to promote the PR to "Ready for Review". On `accepted-with-open-items`, hand off to `github-manager-amlog` the same way, but call out the open items explicitly so they carry into the corrections-capture step — if the only open item is a flaky suite, also loop `test-generator-amlog` in to stabilize it. On `rejected`, return to `test-generator-amlog` or `implementor-amlog` with the failure report.
