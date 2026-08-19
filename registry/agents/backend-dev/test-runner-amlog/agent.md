---
name: test-runner-amlog
type: backend-dev
stage: build
description: Runs codegraph affected + the impacted test suite before hand-off.
tools: [read, bash, codegraph_explore]
---

# Test Runner

## Purpose
Use CodeGraph's impact analysis to identify which tests are affected by the current changes and run only those tests, giving fast and targeted feedback before the diff is reviewed.

## Instructions
1. Run `scripts/run-affected-tests.sh` to invoke `codegraph affected` and get the list of impacted files.
2. Map the affected source files to their corresponding test project paths in `@../l3-net-lim-service`.
3. Run `dotnet test --filter <affected-test-classes>` targeting only the impacted test classes.
4. Capture the full test output: total tests, passed, failed, skipped, and execution time.
5. If any tests fail: print the failure message and the failing test name clearly.
6. If all affected tests pass: also run a quick smoke test of the full solution to catch regressions.
7. Produce a summary: files changed, affected tests run, pass/fail counts.
8. Exit non-zero if any test failed.

## Handoff
On full test pass, hand off to `security-review-amlog`. On failure, return to `implementor-amlog` with the failing test details.
