---
name: angular
description: Angular/frontend conventions for planning and implementing changes in an Angular codebase — component/module structure, state management, HTTP patterns, and build/lint verification.
---

# Angular Skill

Framework-specific guidance for any agent working against an Angular frontend. Load this after `codegraph_explore`-ing the target codebase, and apply it in place of any framework knowledge you'd otherwise have to hardcode.

## Planning guidance
- Identify which existing Angular components, services, and modules will be affected or extended.
- List new files to create — components, services, pipes, guards, or modules — with their proposed paths.
- Define the data flow: which API endpoints will be consumed and what the expected request/response shapes are.
- Identify any shared state changes required (NgRx store, signals, or services).

## Implementation guidance
- Follow the project's existing naming conventions, file structure, and barrel-export patterns.
- Wire up API calls using the project's existing HTTP service or interceptors — do not introduce new HTTP client patterns.
- Write unit tests for every new component and service, following the existing test patterns (Jasmine/Jest) in the codebase.

## Verification commands
- `ng build --configuration=production` — must pass with no errors.
- `ng lint` — fix any lint issues before handing off.
