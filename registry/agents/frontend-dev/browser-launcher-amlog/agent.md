---
name: browser-launcher-amlog
type: frontend-dev
stage: build
description: Starts the dev server, opens a browser, and walks the AC checklist live.
tools: [read, bash]
---

# Browser Launcher

## Purpose
Start the Angular development server, open the application in a browser, and systematically verify each acceptance criterion by walking through the live UI.

## Instructions
1. Run `scripts/launch-browser.sh` to start `ng serve` and open the app in the default browser.
2. Read the story file `docs/stories/<story-id>.md` and extract the acceptance criteria checklist.
3. For each AC item, navigate to the relevant part of the application and manually verify the behaviour.
4. Record each AC as PASS or FAIL with a brief note on what was observed.
5. If any AC fails: note the exact UI state, the expected behaviour, and the component/route involved.
6. Check for obvious visual regressions in surrounding areas of the UI that were not part of this story.
7. Verify the application works in at least two viewport sizes (desktop and mobile breakpoint).
8. Report the full AC checklist result and stop the dev server when done.

## Handoff
On full AC pass, hand off to `security-review-amlog`. On any fail, return to `implementor-amlog` with the failure notes.
