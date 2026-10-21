---
name: bug-triage
description: How to turn a failing QA run into actionable bugs — classifying a failure (product bug, test bug, environment, flaky, contract drift), severity and priority rubric, root-cause localisation, minimal reproduction, de-duplication, and the bug report template.
---

# Bug Triage

A test failure is a symptom. Triage turns it into **one decision per defect**: is it real, how bad, whose is it, how do I reproduce it, and have we seen it before. A good bug report lets a developer start fixing without asking a single question.

## 1. Classify first (never skip this)

| Class | It is this when | Route to |
|---|---|---|
| **product-bug** | The app behaves differently from the AC or the contract, and the test is right | `implementor-amlog` (`fe` or `be` by owner) |
| **test-bug** | The app is right and the test is wrong: stale selector after an intended UI change, wrong expected value, order dependency, bad fixture | `test-generator-amlog` (fix the test). Never "fix" a product bug by editing the test |
| **contract-drift** | Spec, code and consumer disagree, or a breaking change appeared | `implementor-amlog` (`be`), and tell the front end owner if the UI consumes it |
| **environment** | Server won't start, port in use, missing tool/browser/database, network or auth to a dependency, timeouts with no app error | The human. Not a bug on the product; don't file it against the app |
| **flaky** | Passed on retry, or alternates across runs with no code change | File as a test-quality item (low severity); track recurrence; never count as a pass |

How to tell product-bug from test-bug: read the AC and the implementation (`codegraph_explore`), reproduce by hand where possible (call the endpoint with `curl`, open the page with the `webapp-testing` helper), and check git blame/diff for what changed in the failing area. If you can't decide, say so, label it `needs-human`, and give both hypotheses.

## 2. Severity and priority

| Severity | Definition | Examples |
|---|---|---|
| **S1 Critical** | Data loss/corruption, security hole, feature or app unusable, no workaround | Auth bypass, IDOR, save deletes data, page crashes on load, 500 on a core endpoint |
| **S2 Major** | An AC is not met, or a core flow is broken but a workaround exists | Validation not enforced, wrong calculation, breaking API change |
| **S3 Minor** | Works but wrong in a limited way, edge cases, non-core flow | Wrong message text, bad empty state, mobile-only layout glitch, moderate a11y issue |
| **S4 Trivial** | Cosmetic, no functional impact | Misalignment, typo |

Escalate one level when: it is a security issue (auth, injection, data exposure) → at least **S1**; it affects an AC marked must-have; it's a **regression** of something that worked before. A bug that blocks the PR (an AC fails) is never below **S2**.

Priority is about order of fixing: **P1** blocks merge, **P2** fix in this issue, **P3** schedule as follow-up. S1/S2 on an AC → P1. Flaky and S4 → P3.

## 3. Localise the root cause

Don't hand over "the test failed". Narrow it:

1. **Read the evidence**: failure message, stack trace, response body, screenshot, trace, console log.
2. **Find the code**: map the stack frame, route, or endpoint to symbols with `codegraph_explore` (name the endpoint, component, or class). List the 1–3 most likely files/functions, with line references.
3. **Check what changed**: `git log -p` on those files since `main`, and whether this issue's diff touched them. A failure in code this issue didn't touch is a pre-existing bug or a flaky/env issue; say which.
4. **Decide the owner**: files under the front-end root → `fe`; back-end root → `be`; both (a UI-visible API defect) → the layer where the wrong behaviour starts.
5. State your confidence: **confirmed** (reproduced and traced), **likely** (traced, not reproduced), or **suspected** (hypothesis only). Never present a guess as a finding.

## 4. Minimal reproduction

Numbered steps from a clean state, with exact inputs, the expected result, and the actual result. Cut everything that isn't needed: smallest data, fewest clicks, one request. Prefer a copy-pasteable command (`curl`, the single failing test's filter such as `dotnet test --filter "FullyQualifiedName~Orders_Post_Missing"` or `npx playwright test -g "AC-2"`). If it can't be reproduced reliably, say how often it fails and under what conditions.

## 5. De-duplicate and track

Use the ledger (`bug-index.js`, see the agent) to fingerprint each failure (same failing check + same normalised error = same bug). A `known` bug gets a new occurrence, not a new report. A `regressed` bug (it was verified fixed, now fails again) is re-opened and escalated one severity level. When a re-run no longer fails, the ledger marks the bug `verified-fixed`; confirm that on the GitHub issue.

## 6. Bug report template

```markdown
## 🐞 <short, specific title: what breaks, where>

**ID:** BUG-<n> · **Issue:** #<issue-number> · **AC:** AC-<n> · **Found by:** <agent> · **Fingerprint:** <12 hex>
**Class:** product-bug · **Severity:** S2 · **Priority:** P1 · **Owner:** be · **Confidence:** confirmed
**State:** new | known (×<occurrences>) | regressed

### Expected
<what the AC / contract says should happen>

### Actual
<what happens instead; exact message / status code / UI state>

### Steps to reproduce
1. …
2. …

**Repro command:** `<one command>`

### Evidence
- <screenshot / trace / response body paths, error output>

### Suspected cause
<file:line / symbol, why, and whether this issue's diff touched it>

### Impact
<who/what is affected; security or data impact if any>

### Suggested fix direction
<one or two sentences; no code unless trivial>

### Regression test
<the test that now catches this; it must stay in the suite>
```

Labels to apply when filing: `bug`, `severity:S<n>`, `priority:P<n>`, `area:fe` or `area:be`, `found-by:qa`, plus `flaky` or `regression` where they apply.

## 7. Never

- File an environment problem as a product bug.
- Report the same defect twice, or split one root cause into several bugs because it shows in several tests. Group them under one bug with all the failing tests listed.
- Edit production code or tests. Triage reports; implementors and the test generator fix.
- Guess at severity to look decisive. Use the rubric and show the reason.
