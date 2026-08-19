---
name: code-quality-amlog
type: dev
stage: build
description: Triggers SonarQube scan and enforces the quality gate.
tools: [read, bash]
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
On gate pass, hand off to `review-amlog`. On gate failure, return to the implementor for remediation.
