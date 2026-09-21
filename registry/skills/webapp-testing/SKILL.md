---
name: webapp-testing
description: Toolkit for driving and testing a locally running web app with Playwright — verifying UI behavior, capturing screenshots, and reading browser console logs — without needing a human or a computer-use agent to click through it.
---

# Web Application Testing

Adapted from Anthropic's official `webapp-testing` skill (github.com/anthropics/skills, Apache-2.0 — see `THIRD_PARTY_NOTICE.md` in this folder) for amlog-workflow's browser-driven AC verification.

To verify a locally running web app, write a small, one-off Python Playwright script per verification session — don't try to write one generic script that covers every app or every issue.

## Bootstrap (first use in a workspace)
Check that `python3 -c "import playwright"` succeeds. If not, run once: `pip install playwright && python3 -m playwright install chromium --with-deps`.

## Helper script
`scripts/with_server.py` starts the dev server(s), waits for them to be ready, runs your automation script, then stops the server(s) when it exits. Always run it with `--help` first.

Single server:
```bash
python3 scripts/with_server.py --server "<dev-server-command>" --port <port> -- python3 <your_script>.py
```

Multiple servers (e.g. frontend + backend):
```bash
python3 scripts/with_server.py \
  --server "<backend-command>" --port <backend-port> \
  --server "<frontend-command>" --port <frontend-port> \
  -- python3 <your_script>.py
```

## Decision tree
- Static HTML → read the file directly to find selectors, write a Playwright script using `file://` URLs.
- Dynamic app, server not running → use `scripts/with_server.py` to start it and run your script against it in one shot.
- Dynamic app, server already running → reconnaissance-then-action: navigate, `page.wait_for_load_state('networkidle')`, screenshot/inspect the DOM to find selectors, then act.

## Common pitfall
Don't inspect the DOM before `page.wait_for_load_state('networkidle')` on a dynamic app — you'll see a stale or empty page and draw the wrong conclusion.

## Best practices
- Launch `chromium.launch(headless=True)`; always close the browser when done.
- Prefer descriptive selectors (`text=`, `role=`, or an existing test id) over brittle CSS paths.
- Capture console logs (`page.on('console', ...)`) to catch obvious runtime errors, not just visual state.
- Test at least two viewport sizes for responsive checks — e.g. desktop (1920x1080) and mobile (375x667).
- Save screenshots somewhere the calling agent can reference as evidence (e.g. `.amlog/qa/screenshots/<issue-number>/`).

## Reference examples
- `examples/element_discovery.py` — enumerate buttons/links/inputs on a page, take a full-page screenshot.
- `examples/console_logging.py` — capture console messages during an interaction.
