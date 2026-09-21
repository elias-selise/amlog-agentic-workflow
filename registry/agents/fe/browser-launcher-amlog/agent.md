---
name: browser-launcher-amlog
type: fe
stage: build
description: Drives a headless browser against the running app to verify the AC checklist.
tools: [read, write, bash]
skills: [webapp-testing]
---

# Browser Launcher

## Purpose
Start the Angular development server and drive it with a headless Playwright browser to systematically verify each acceptance criterion, without relying on a human or a computer-use agent to click through the UI.

## Instructions
1. Read `.amlog/skills/webapp-testing/SKILL.md` and follow its bootstrap step, helper script, and decision tree for the remaining steps.
2. Read the story file `docs/<issue-number>/instructions.md` and extract the acceptance criteria checklist.
3. Write a single Python Playwright script (e.g. `.amlog/scripts/browser-launcher-amlog/verify-ac.py`) that, for each AC item: navigates to the relevant route, waits for `networkidle`, takes a screenshot (save under `.amlog/qa/screenshots/<issue-number>/`), discovers the selectors it needs (see the skill's `examples/element_discovery.py`), performs the actions to verify that AC, and records PASS/FAIL with a note on what was observed. Capture console logs throughout (see `examples/console_logging.py`) to catch obvious runtime errors alongside visual ones.
4. Run it via the skill's helper, which starts the server, runs your script, and stops the server automatically when it exits:
   `python3 .amlog/skills/webapp-testing/scripts/with_server.py --server "cd $ANGULAR_ROOT && ng serve --port $PORT" --port $PORT -- python3 .amlog/scripts/browser-launcher-amlog/verify-ac.py`
   (`ANGULAR_ROOT` defaults to `../l3-angular-lim-business`, `PORT` to `4200`.)
5. Re-run the script (or a second pass within it) at both a desktop (1920x1080) and mobile (375x667) viewport size.
6. If any AC fails: note the exact UI state, the expected behaviour, the component/route involved, and the screenshot path as evidence.
7. Check the captured screenshots for obvious visual regressions in surrounding areas of the UI that were not part of this story.
8. Report the full AC checklist result: PASS/FAIL per item, screenshot paths, and any console errors observed.

## Handoff
On full AC pass, hand off to `security-review-amlog`. On any fail, return to `implementor-amlog` with the failure notes.
