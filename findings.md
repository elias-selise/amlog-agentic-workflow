# Findings: amlog-workflow repo audit

Audit of installation flow, CodeGraph integration, and CI. Two items (CodeGraph
resolution hardening, install smoke-test CI) have already been fixed — see
`src/lib/knowledge-base.js` and `.github/workflows/install-smoke-test.yml`.
The rest are open.

## Fixed

1. **`getCodegraphCommand()` re-resolved on every call.** It spawned
   `codegraph --version` fresh each time — called from 5+ places per
   `amlog install` run. Now cached per process.
   (`src/lib/knowledge-base.js`)

2. **Windows `which npm` fallback was broken.** `which` isn't a native Windows
   command, so the npm fallback in `installCodegraph()` silently failed on
   plain Windows/CMD. Now probes `npm --version` directly with `shell: true`.
   (`src/lib/knowledge-base.js`)

3. **Silent `spawnSync` failures.** `wireCodegraph()` and the
   `codegraph upgrade --check` call never checked `result.status`, so
   failures printed as if nothing went wrong. Now logs a warning on non-zero
   exit. (`src/lib/knowledge-base.js`)

4. **No CI coverage of the actual install flow.** `publish.yml` only ran a
   no-op `npm test` before publishing; the OS-specific install logic (which
   already needed one real bugfix) was never exercised in CI. Added
   `.github/workflows/install-smoke-test.yml`, matrixed over
   ubuntu/macos/windows, running `amlog install --ba --yes` → `status` →
   `uninstall` against the local checkout.

## Open

5. **`--ba` silently excludes the `dev` agent type.** `resolveTargetTypes()`
   (`src/lib/manifest.js`) adds `dev` for `--frontend`, `--backend`, and
   `--qa`, but not for `--ba`. BA-only installs never get
   `knowledge-base-setup`, `researcher-amlog`, `security-review-amlog`,
   `code-quality-amlog`, `review-amlog`, `kb-curator-amlog`, or the `dev`
   variant of `github-manager-amlog`. Yet the knowledge-base bootstrap step
   still runs unconditionally regardless of role — so the set of "agents
   installed" and "KB bootstrap run" is inconsistent specifically for BA
   users. This repo's own `.amlog/agents/` (only a `ba/` folder, no `dev/`)
   is live evidence of the behavior. Looks unintentional rather than a
   design choice.
Ans: ba should not have dev agents
6. **No real test suite.** `package.json`'s `"test"` script is
   `echo 'No tests yet — skipping' && exit 0`. There is no unit coverage for
   `resolveTargetTypes`/`filterAgents` (would have caught #5 directly),
   `copyAgents`, or `detectAgentInstructionFile`.
Ans: Skip for now
7. **`eslint` not wired into CI**, and currently broken locally: ESLint 9
   requires `eslint.config.js` (flat config), but the repo only has whatever
   config predates that — running `npm run lint` fails immediately with
   "ESLint couldn't find an eslint.config.js file." The `lint` script exists
   in `package.json` but `publish.yml` never calls it.
Ans: Skip for now
8. **`package-lock.json` inconsistency.** It's listed in `.gitignore` but is
   actually committed and tracked, and CI's `npm install` relies on it being
   present. The gitignore entry is misleading/wrong.
Ans: Skip for now
9. **Repo/package name mismatch.** `package.json`'s `homepage` and
   `repository.url` point at `github.com/selise/amlog-workflow`, but the
   actual git remote is `amlog-agentic-workflow`.
Ans: Skip for now
10. **No version pinning for CodeGraph installs.** Both the curl/irm
    CodeGraph installer scripts and the npm fallback
    (`npm i -g @colbymchenry/codegraph`) always pull latest/`main` — installs
    aren't reproducible and can silently change behavior across machines or
    over time without any change in this repo.
Ans: Add latest version which will work with our app
11. **`amlog update` never re-runs the knowledge-base bootstrap.** If a user
    adds zones to `amlog-workflow.config.json` after initial install, running
    `amlog update` re-copies agent files but does not re-run `codegraph init`
    for the new zones — a full `uninstall`/`install` cycle is needed instead.
Ans: fix it.
12. **No `amlog doctor`-style diagnostic command.** Given Windows PATH
    resolution has already needed one real fix (`436e966`), a command that
    reports Node version, resolved CodeGraph command/path, and detected
    agent-CLI config files would make future cross-platform issues much
    faster to triage from a bug report.
Ans: fix it.
13. **`install.sh`/`install.ps1` have no internal OS branching** (each
    assumes its own OS, which is fine) but also aren't exercised by any CI —
    they install the *published* npm package, so they can't be tested against
    local changes pre-publish. The new smoke-test workflow deliberately does
    not cover them; a separate `npm pack`-based variant would be needed to
    test them without depending on what's already on the npm registry.
Ans: Skip for now

## Fixed (round 2)

14. **Cache poisoning on fresh CodeGraph installs (both user-observed bugs
    below share this one root cause).** `bootstrapKnowledgeBase()` resolves
    and caches `getCodegraphCommand()` *before* `installCodegraph()` runs. On
    a machine without CodeGraph, that first resolution caches the `'codegraph'`
    fallback string. Once `installCodegraph()` finishes installing the binary,
    the module-level cache (added in fix #1) was never invalidated, so every
    subsequent call in the same process (`wireCodegraph`, `initZones`,
    `printZoneStatus`) kept reusing the stale fallback — which fails because
    the freshly installed binary isn't on the current terminal's PATH yet
    (installers persist PATH via the registry/profile, which only applies to
    *new* shell sessions, not the one that's already running).
    - *User-observed symptom 1:* "on Windows, if codegraph isn't installed,
      installing it and then running `codegraph init` in the same terminal
      fails." — this was exactly the stale-cache read right after
      `installCodegraph()` returns, within the same `amlog install` run.
    - *User-observed symptom 2:* "we don't have to install codegraph for
      every installation" — `isCodegraphInstalled()` was already correctly
      guarded and wasn't literally reinstalling the binary each time; the
      apparent repeated-install behavior was this same cache bug making
      CodeGraph look "not installed" immediately after it was.
    - **Fix:** `installCodegraph()` now resets the cache (`cachedCommand =
      null`) on every successful install path, forcing the next
      `getCodegraphCommand()` call to re-resolve — which correctly finds the
      new binary via the known-install-path fallback (no PATH dependency).
      (`src/lib/knowledge-base.js`)

15. **No version pinning for CodeGraph installs.** Upstream's `install.sh`
    and `install.ps1` both honor a `CODEGRAPH_VERSION` env var (confirmed by
    reading the scripts directly); previously neither that var nor an npm
    version tag was ever set, so every install tracked latest/main. Added a
    `PINNED_CODEGRAPH_VERSION` constant (currently `1.6.0`, the latest
    release at time of writing) and pass it through
    `CODEGRAPH_VERSION=v1.6.0` for the curl/irm installers and
    `@colbymchenry/codegraph@1.6.0` for the npm fallback. Bump this constant
    deliberately (and re-test `amlog install`) rather than always tracking
    upstream's latest. (`src/lib/knowledge-base.js`)

16. **`amlog update` never re-ran the knowledge-base bootstrap.** Added
    `syncZones()` to `src/lib/knowledge-base.js` (re-indexes configured zones
    + prints status, without touching CodeGraph's own install/wiring) and
    call it from `runUpdate()` when CodeGraph is already installed. Zones
    added to `amlog-workflow.config.json` after initial install now get
    picked up by `amlog update` instead of requiring a full
    uninstall/reinstall. (`src/commands/update.js`)

17. **Added `amlog doctor`.** New command
    (`src/commands/doctor.js`, wired into `bin/amlog.js`) reports Node
    version, platform/arch, the resolved CodeGraph command and whether it's
    reachable, the detected agent-instruction file, and whether `.amlog/` is
    present — for fast triage of exactly the kind of cross-platform install
    issue found in #14.
