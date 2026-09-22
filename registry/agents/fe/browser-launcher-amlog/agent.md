---
name: browser-launcher-amlog
type: fe
stage: build
description: Drives a headless browser against the running app to verify the AC checklist.
tools: [Read, Write, Bash]
skills: [webapp-testing]
---

# Browser Launcher

## Purpose
Start the front-end development server and drive it with a headless Playwright browser to systematically verify each acceptance criterion, without relying on a human or a computer-use agent to click through the UI.

## Instructions
1. Read `.amlog/skills/webapp-testing/SKILL.md` and follow its bootstrap step, helper script, and decision tree for the remaining steps.
2. Read the story file `docs/<issue-number>/instructions.md` and extract the acceptance criteria checklist.
3. Detect the dev-server command and port from the target codebase's `package.json` `scripts` (e.g. `ng serve` for Angular, `vite`/`next dev`/`react-scripts start` for React) rather than assuming a fixed framework.
4. Write a single Python Playwright script (e.g. `.amlog/scripts/browser-launcher-amlog/verify-ac.py`) that, for each AC item: navigates to the relevant route, waits for `networkidle`, takes a screenshot (save under `.amlog/qa/screenshots/<issue-number>/`), discovers the selectors it needs (see the skill's `examples/element_discovery.py`), performs the actions to verify that AC, and records PASS/FAIL with a note on what was observed. Capture console logs throughout (see `examples/console_logging.py`) to catch obvious runtime errors alongside visual ones.
5. Run it via the skill's helper, which starts the server, runs your script, and stops the server automatically when it exits:
   `python3 .amlog/skills/webapp-testing/scripts/with_server.py --server "cd $FRONTEND_ROOT && <detected dev-server command> --port $PORT" --port $PORT -- python3 .amlog/scripts/browser-launcher-amlog/verify-ac.py`
   (`FRONTEND_ROOT` defaults to `../l3-angular-lim-business` for Angular targets; `PORT` defaults to the framework's usual dev port, e.g. `4200` for Angular or `3000`/`5173` for React, unless `package.json` says otherwise.)
6. Re-run the script (or a second pass within it) at both a desktop (1920x1080) and mobile (375x667) viewport size.
7. If any AC fails: note the exact UI state, the expected behaviour, the component/route involved, and the screenshot path as evidence.
8. Check the captured screenshots for obvious visual regressions in surrounding areas of the UI that were not part of this story.
9. Report the full AC checklist result: PASS/FAIL per item, screenshot paths, and any console errors observed.

## Handoff
- **Full AC pass:** → `security-review-amlog` (`dev`) — proceed to the security pre-review.
- **Any AC fail:** → `implementor-amlog` (`fe`) — return with the failure notes, exact UI state, and screenshot paths as evidence.

Hand off the moment the condition is met — don't wait to be re-prompted, and don't just narrate it. If your tool can invoke another agent/subagent directly, do that now. If it can't, end your final message with the matching line so the next step is never left implicit:
`NEXT AGENT: security-review-amlog (dev) — AC checklist passed for issue <issue-number>`
`NEXT AGENT: implementor-amlog (fe) — AC checklist failed for issue <issue-number>, see failure notes above`
