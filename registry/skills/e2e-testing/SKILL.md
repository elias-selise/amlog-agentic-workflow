---
name: e2e-testing
description: How to write and run durable end-to-end tests for a web front end — choosing journeys from the acceptance criteria, stable selectors, deterministic waits, test data and auth, accessibility and console checks, viewport coverage, and flake control. Framework-agnostic, Playwright by default.
---

# End-to-End Testing

E2E tests prove a **user journey works through the real UI** (browser → front end → API → data). They are the slowest and most fragile tests, so each one has to earn its place: a handful of high-value journeys, written to be deterministic, beats a hundred brittle ones.

This skill is for the **durable regression suite** that lives in the repo and runs in CI. It is different from `webapp-testing`'s one-off verification scripts: reuse that skill's `with_server.py` helper to start the app, but write the tests as real spec files.

Follow the codebase. If the repo already has Playwright, Cypress or similar, extend it: same folder, fixtures, page objects, naming, config. Only bootstrap a new suite (Playwright, `@playwright/test`) when there is none, and say so in the report.

## 1. Choose the journeys (don't test everything)

Derive them from the story AC (`docs/<issue-number>/instructions.md`), then rank by risk:

1. **Happy path** of each AC, end to end, as a user would do it.
2. **The unhappy path the AC names**: validation message, permission denied, empty state, server error.
3. **Regression neighbours**: the existing journeys that share the touched route, component, or API call (find them with `codegraph_explore` on the changed components and their routes).
4. **Cross-cutting checks** on every touched page: no console errors, no failed network calls, basic accessibility, works at mobile width.

Skip what unit tests already cover (pure formatting, single-component logic). Each test name carries its AC id: `AC-2 shows an error when the password is wrong`.

## 2. Stable selectors

Priority: accessible role + name (`getByRole('button', { name: 'Save' })`) → label/placeholder/text the user sees → a dedicated `data-testid`. Never CSS classes, DOM position, or generated ids. If an element has no stable handle, add a `data-testid` to the component (a tiny, additive production change; mention it in the report) rather than writing a brittle selector.

## 3. Deterministic by construction

- **Wait on conditions, never time.** Use the framework's auto-waiting and web-first assertions (`await expect(locator).toBeVisible()`). No `waitForTimeout`/`sleep`. Wait for a specific response (`waitForResponse`) or a visible state, not "networkidle" as a crutch.
- **Own your data.** Each test creates (via API/seed) and cleans up what it needs; no dependency on records from earlier tests or a particular database state. Unique names (`e2e-<timestamp>-<rand>`) so parallel runs don't collide.
- **Authenticate once, reuse.** Log in through the API or a setup project and reuse the stored session state; log in through the UI only in the test that is about logging in.
- **Isolate from the outside world.** Stub third-party services (payments, email, maps); never hit production or shared environments. Control time and randomness when the UI shows them.
- **Independent tests.** Any test can run alone and in any order.
- **Retry only to detect flakiness**, not to hide it: one retry, and a test that passes on retry is reported `flaky`, never `pass`.

## 4. What to check beyond the click-through

- **Console and network**: fail on `console.error`, uncaught exceptions, and failed (4xx/5xx) requests that the journey didn't deliberately cause. Attach a listener in a shared fixture.
- **Accessibility**: run axe (`@axe-core/playwright`) on each touched page/state; fail on `serious` and `critical` violations, list `moderate` ones as warnings. Check keyboard-only flow for the new interaction (Tab order, Enter/Space, Escape closes dialogs) and visible focus.
- **Responsive**: run the touched journeys at desktop (1920×1080) and mobile (375×667) as separate projects.
- **Visual** (only if the repo already uses snapshots): screenshot assertions on the changed component, with animations disabled and dynamic content masked. Don't introduce visual snapshots to a repo that doesn't have them.
- **Performance smoke**: note any step that takes unusually long, or a page that never settles. Don't turn it into a hard gate without a budget.

## 5. Evidence

Configure (or confirm) the suite keeps `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`, and `video: 'retain-on-failure'`. Every failure in the report must point at its screenshot and trace so a developer can see it without re-running. Save under `.amlog/qa/e2e/` or the framework's default `test-results/`, and list the paths in the report's `evidence`.

## 6. Running it

`run-e2e.sh` detects the suite, starts the app (the config's `webServer`, or `E2E_SERVER_CMD` + `E2E_PORT` through `webapp-testing`'s `with_server.py`), runs with one retry, and writes `.amlog/qa/e2e-report.json`. Narrow a run with `E2E_GREP="AC-2"` or `E2E_PROJECT=mobile`.

## 7. Depth

`smoke` (front end changed, but not templates/routes/styles): run the existing journeys that touch the changed components, plus the console/network check. `full` (templates, routes, components, or styles changed): all journeys from section 1, accessibility, and both viewports.

## 8. When it fails

Decide **product bug vs test bug vs environment** before reporting (see the `bug-triage` skill). A selector that broke because of a deliberate UI change is a test to update, not a bug; a server that wouldn't start is `error`, not `fail`. Never weaken or delete an assertion to get green.
