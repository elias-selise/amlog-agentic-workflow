---
name: qa-scope
description: Shared QA-track rules. Decides which optional testers apply to a change (API contract tester for back-end changes, E2E tester for front-end changes), defines the standard QA report file every tester writes, and the order of the QA chain.
---

# QA Scope & Report Contract

This is a process skill. It describes how the QA agents coordinate, not how the codebase looks, so don't edit it when the codebase changes.

## 1. Which tester runs?

The API contract tester and the E2E tester are **optional**. A front-end-only change needs no API contract run, and a back-end-only change needs no E2E run. Decide with the helper, never by guessing:

```bash
node .amlog/skills/qa-scope/scripts/detect-scope.js --issue <issue-number>
```

It reads the front-end and back-end roots (`FRONTEND_ROOT` / `BACKEND_ROOT`, else `zones` in `.amlog/amlog-workflow.config.json`, else the `../l3-*` defaults), looks at what changed (committed vs `main`, plus the working tree), and writes `.amlog/qa/scope.json`:

| Field | Meaning |
|---|---|
| `run.apiContract` | `true` when back-end code changed → `api-contract-tester-amlog` applies |
| `run.e2e` | `true` when front-end code changed → `e2e-tester-amlog` applies |
| `depth.*` | `full` when the API surface (controllers, DTOs, validators, OpenAPI) or the UI surface (templates, routes, components, styles) changed; `smoke` when only internals changed |
| `reasons.*` | One line explaining each decision |

Full-stack change → both run. Pass `--force api,e2e` only when the user asks for a tester that scope would skip.

A skipped tester still writes a report (section 3) with `status: "skipped"` and the reason from `scope.json`. A skip is a visible, explained decision, never a silent omission.

**Blocked, not skipped:** on a full-stack change, if the API contract tester fails, the E2E tester does **not** run. The front end would only report symptoms of a broken back end. Write the E2E report with `status: "skipped"`, `reason: "blocked by API contract failure"`, and let the bug triage hand the back-end failure to the implementor first.

## 2. QA chain order

`test-generator-amlog` → `api-contract-tester-amlog` (if back-end changed) → `e2e-tester-amlog` (if front-end changed) → `test-executor-amlog`

Each stage passes to the next applicable one. A stage that doesn't apply writes its skip report and hands straight on. Any failure goes to `bug-triage-amlog` instead, which routes it to the right implementor. `test-executor-amlog` reads every report and folds it into the single QA verdict.

## 3. Standard report file

Every QA tester writes `.amlog/qa/<report-name>-report.json` (`api-contract-report.json`, `e2e-report.json`):

```json
{
  "agent": "e2e-tester-amlog",
  "issue": "42",
  "status": "pass | fail | flaky | skipped | error | no-tests",
  "reason": "why it was skipped / what went wrong (required for skipped, error, no-tests)",
  "depth": "full | smoke",
  "startedAt": "ISO-8601",
  "durationMs": 0,
  "model": "model used for this run",
  "totals": { "total": 0, "passed": 0, "failed": 0, "skipped": 0, "flaky": 0 },
  "failures": [
    {
      "id": "stable test or check id",
      "title": "human-readable name",
      "category": "contract | functional | validation | auth | accessibility | visual | console-error | performance | environment",
      "ac": "AC-2 (the acceptance criterion it covers, when known)",
      "message": "first error line",
      "detail": "stack trace / response diff / expected vs actual",
      "evidence": ["relative/path/to/screenshot-or-trace-or-response.json"]
    }
  ],
  "artifacts": ["relative/paths worth keeping"]
}
```

Status meanings:

- `pass`: everything ran and passed.
- `fail`: at least one hard failure. Hand off to `bug-triage-amlog`.
- `flaky`: failed, then passed on retry. Goes to the "needs investigation" bucket, never straight to pass. Hand on, but list the flaky tests so the triage and executor can see them.
- `skipped`: scope said it doesn't apply, or it was blocked. Always has a `reason`.
- `error`: the tester couldn't run (server wouldn't start, spec not found, tool missing). This is **not** a pass. Say what's missing and ask the human how to proceed.
- `no-tests`: it ran but found nothing to run. The tester must write tests (see its agent file), not report success.

Record `model` and `durationMs` (and token usage if your tool exposes it) on every run, so agent metrics stay comparable.
