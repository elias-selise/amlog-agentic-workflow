# amlog-workflow — Build Specification

## 1. Goal

One package, `amlog-workflow`, installable with a single command, that:

1. Sets up a per-repo knowledge graph using
   [CodeGraph](https://github.com/colbymchenry/codegraph) — checking
   whether it's installed, installing it if not, and initializing it for
   the workspace.
2. Installs the agentic SDLC agent roster (Business Analyst, front-end dev,
   back-end dev, QA) into the workspace — but only the agents relevant to
   whoever is running the install, selected by `type`.
3. Ships each agent as a self-contained unit: an agent definition (the
   "skill") plus whatever scripts that agent actually needs to do its job.

This mirrors two things already decided:
- The **Platform Hub** install pattern (`amlog-workflow install frontend` /
  `amlog-workflow install backend` / `amlog-workflow install qa`) — selective installation by
  role, so nobody downloads agents or knowledge irrelevant to them.
- **CodeGraph's own** install UX (`curl ... | sh` / `irm ... | iex` /
  `npm i -g`, then a two-step `install` + `init`) — copy this pattern
  exactly rather than inventing a new one, so it feels familiar to anyone
  who's already used CodeGraph.

> NOTE: initially we will use these agent for our project `l3-angular-lim-business` & `l3-net-lim-service`. their path `@../l3-net-lim-service` and `@../l3-angular-lim-business`.
> This is phase-1 of agent building, so don't write tons of things at once. Write the basic instructions for each agents to do the work. It can be 5 to 10 instructions for each of them. Then we will update.
---

## 2. Package identity

| | |
|---|---|
| Package name | `amlog-workflow` |
| CLI binary name | `amlog` |
| Distribution | npm package (`npm i -g amlog-workflow`) **and** standalone installer scripts (`install.sh`, `install.ps1`) hosted in the package's GitHub repo, same pattern as CodeGraph |
| Node requirement | Bundle a runtime the same way CodeGraph does (no Node required for the curl/irm path) — if that's too heavy for v1, it's acceptable to require Node 18+ for v1 and note the bundled-runtime version as a fast-follow |

---

## 3. Installation UX

Mirror CodeGraph's two-step shape: install the CLI once, then run it inside
each workspace to actually pull in agents.

**Step 1 — install the CLI (once per machine):**

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/<org>/amlog-workflow/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/<org>/amlog-workflow/main/install.ps1 | iex

# Already have Node? npm works too
npm i -g amlog-workflow

# Or skip the install entirely and run once
npx amlog-workflow
```

**Step 2 — pull agents into a workspace, selected by role:**

```bash
cd my-project

amlog install --frontend        # frontend-dev + dev (cross-cutting) agents
amlog install --backend         # backend-dev + dev agents
amlog install --qa              # qa
amlog install --ba              # ba
amlog install --all             # everything
amlog install --target=frontend-dev,qa   # explicit csv, for anyone who wants more than one role
```

Every `amlog install` invocation also runs the knowledge-base bootstrap
(Section 6) as part of the same command — a developer should not need two
separate commands to get both the agents and a working knowledge graph.

**Updating:**

```bash
amlog upgrade         # updates the CLI itself
amlog update          # re-pulls the latest agent definitions for whatever
                       # roles are already installed in this workspace
```

**Removing:**

```bash
amlog uninstall        # removes agents + knowledge base wiring from this workspace
amlog uninstall --keep-knowledge-base   # keep the .codegraph index, remove agents only
```

---

## 4. CLI command reference

```
amlog                          Interactive installer (prompts for role)
amlog install [flags]          Install agents + bootstrap knowledge base
amlog update                   Refresh already-installed roles to latest
amlog uninstall [flags]        Remove agents (and optionally the KB) from this workspace
amlog upgrade [version]        Update the amlog CLI itself
amlog list                     Show every agent in the registry, with type/stage
amlog status                   Show what's installed in the current workspace + CodeGraph index status
amlog version                  Print installed CLI version
```

| Flag | Values | Applies to |
|---|---|---|
| `--target` | csv of types: `ba,frontend-dev,backend-dev,qa,dev` | `install`, `update` |
| `--frontend` / `--backend` / `--qa` / `--ba` / `--all` | shorthand for `--target=<type>,dev` (dev is cross-cutting, always included) | `install` |
| `--yes` | skip prompts | `install`, `uninstall` |
| `--location` | `global` \| `local` | `install` — where the CLI's own config lives, same meaning as CodeGraph's flag |
| `--keep-knowledge-base` | boolean | `uninstall` |

---

## 5. What `amlog install --frontend` actually does

Step by step — this is the core logic the CLI's `install` command needs to
implement:

1. Resolve `--frontend` → `target = ["frontend-dev", "dev"]`.
2. Read `registry/manifest.json` (bundled in the npm package) and filter to
   agents whose `type` is in `target`.
3. Copy each matching agent's whole folder (`agent.md` + its `scripts/` if
   present) into `.amlog/agents/<type>/<agent-name>/` in the current
   workspace — git-ignored, same convention as Platform Hub's
   `.agents/` / `.knowledge/`.
4. Write/refresh a small marker-fenced section into the workspace's agent
   instructions file (`CLAUDE.md` / `AGENTS.md` — detect which exists, same
   idea as CodeGraph's own installer) listing what got installed and how to
   invoke each agent, so agent CLIs that don't read `.amlog/` directly
   still know these agents exist.
5. Run the knowledge-base bootstrap (Section 6).
6. Print a summary: which agents were installed, whether CodeGraph was
   freshly installed or already present, and per-zone index stats.

`amlog update` repeats steps 2–4 only, for whatever `type`s are already
present under `.amlog/agents/` — it doesn't need `--target` re-specified.

---

## 6. Knowledge-base bootstrap (CodeGraph)

This is not a separate command — it's the last step of every `amlog
install`, and it's also exposed standalone as `amlog status`/`init` for
re-runs. Implement it as both (a) a real script the CLI shells out to, and
(b) an agent definition (`knowledge-base-setup`, type `dev`) so any agent
CLI can also invoke it directly mid-session.

**Logic:**

1. Check whether the `codegraph` CLI is on PATH.
   - If yes: run `codegraph upgrade --check` and note if an update is
     available (don't force it).
   - If no: install it —
     `curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh`
     on macOS/Linux, the `.ps1` equivalent on Windows, falling back to
     `npm i -g @colbymchenry/codegraph` if `curl`/`irm` aren't available.
2. Run `codegraph install --target=auto --location=global --yes` to wire
   the CodeGraph MCP server into whatever agent CLI(s) are detected in this
   environment.
3. Look for `amlog-workflow.config.json` at the repo root:
   ```json
   {
     "adapter": "codegraph",
     "zones": { "frontend": "./frontend", "backend": "./backend", "database": "./database" },
     "businessDocs": "./docs/business",
     "output": "./.knowledge-graph"
   }
   ```
   - If present, run `codegraph init` inside each path listed under
     `zones`.
   - If absent, run `codegraph init` once at the repo root as a single
     zone, and print a note suggesting the user add a
     `amlog-workflow.config.json` if this is a multi-zone repo (front end +
     back end in one repo).
4. Print `codegraph status` for each indexed zone so the summary shows real
   numbers (files/symbols/edges), not just "done".

This logic already exists as a working bash script from a previous session
— port it into the CLI's `init`/`install` code path rather than
reimplementing from scratch; the reference version is at the end of this
document (Appendix A) for convenience.

---

## 7. Full agent roster

Every agent below needs an `agent.md` (the skill/definition) under
`registry/agents/<type>/<agent-name>/`, plus a `scripts/` folder only where
noted — don't create an empty `scripts/` folder for agents that don't need
one.

> **Naming note:** the front-end and back-end implementation agents share
> the exact same name, `implementor-amlog` — they are distinguished only by
> their `type` field (`frontend-dev` vs `backend-dev`), not by name. This
> is intentional; don't rename one of them to disambiguate.

| Name | Type | Stage | Needs a script? | Purpose |
|---|---|---|---|---|
| `knowledge-base-setup` | `dev` | platform | ✅ `setup-knowledge-base.sh` | Installs/initializes CodeGraph (Section 6) |
| `story-writer-amlog` | `ba` | ba | — | Turns a raw request into a structured story + acceptance criteria |
| `kb-updater` | `ba` | ba | — | Proposes glossary/business-rule entries to the local `_pending` file |
| `github-manager-amlog` | `dev` | cross-cutting | optional: `commit-and-pr.sh` | Owns card creation, gitmoji commits, branch/PR automation, board sync |
| `researcher-amlog` | `dev` | planning | — | Shared research support for either planner (libraries, external APIs, prior art) |
| `planner-amlog` | `frontend-dev` | planning | — | Breaks spec into a front-end implementation plan, using `codegraph_explore` |
| `planner-amlog` | `backend-dev` | planning | — | Breaks spec into a back-end implementation plan, using `codegraph_explore` |
| `implementor-amlog` | `frontend-dev` | build | — | Implements the planned Angular changes |
| `implementor-amlog` | `backend-dev` | build | — | Implements the planned .NET changes (same name, different type — see note above) |
| `browser-launcher-amlog` | `frontend-dev` | build | ✅ `launch-browser.sh` | Starts the dev server, opens a browser, walks the AC checklist live |
| `test-runner-amlog` | `backend-dev` | build | ✅ `run-affected-tests.sh` | Runs `codegraph affected` + the impacted test suite before hand-off |
| `security-review-amlog` | `dev` | build | — | Scans the diff for injection risks, secrets, unsafe input handling |
| `code-quality-amlog` | `dev` | build | ✅ `run-sonarqube.sh` | Triggers SonarQube scan, enforces the quality gate |
| `review-amlog` | `dev` | build | — | Automated pre-review pass against AC and existing conventions |
| `test-generator-amlog` | `qa` | qa | — | Writes edge-case tests the pre-QA gate didn't cover |
| `test-executor-amlog` | `qa` | qa | ✅ `run-test-suite.sh` | Runs the full suite, reports pass/fail |
| `kb-curator-amlog` | `dev` | platform | ✅ `curate-knowledge.sh` | Daily sweep of every repo's `_pending` files into one PR against the shared knowledge base |

This is the same roster discussed in the attached Excalidraw diagram
(Story-Writer, Knowledge-Base Updater, Board-Sync → consolidated into
`github-manager-amlog`, Planner, Research, Coding → `implementor-amlog`,
Security-Review, Code-Quality, Review, Browser/Test-Launcher, Commit →
also folded into `github-manager-amlog`, Test-Generation, Test-Execution) plus
the two platform-level agents (`knowledge-base-setup-amlog`, `kb-curator-amlog`) added
when the design scaled to multiple repos.

---

## 8. Agent file format

Every `agent.md` uses this frontmatter shape — keep it identical across
all agents so `amlog list` and any orchestrator can parse it uniformly:

```markdown
---
name: implementor-amlog
type: frontend-dev
stage: build
description: One sentence, third person, describing what this agent does.
tools: [read, write, edit, bash, codegraph_explore]
---

# <Title>

## Purpose
...

## Instructions
1. ...

## Handoff
Which agent this one passes work to next.
```

If the agent has a `scripts/` folder, reference the script by relative
path in its Instructions section (e.g. `Run scripts/launch-browser.sh`),
don't inline the script logic into the markdown.

---

## 9. Package repo structure

```
amlog-workflow/
├── install.sh                     # curl-piped installer, mirrors CodeGraph's
├── install.ps1                    # irm-piped installer, mirrors CodeGraph's
├── package.json
├── bin/
│   └── amlog.js                   # CLI entry point
├── src/
│   ├── commands/
│   │   ├── install.js
│   │   ├── update.js
│   │   ├── uninstall.js
│   │   ├── upgrade.js
│   │   ├── list.js
│   │   └── status.js
│   └── lib/
│       ├── manifest.js            # reads/filters registry/manifest.json
│       ├── copy-agents.js         # copies matching agent folders into .amlog/
│       ├── detect-agent-cli.js    # finds CLAUDE.md / AGENTS.md / GEMINI.md etc.
│       └── knowledge-base.js      # the CodeGraph bootstrap logic (Section 6)
├── registry/
│   ├── manifest.json              # full agent registry — see Section 10 schema
│   ├── knowledge-base-setup/
│   │   ├── agent.md
│   │   └── scripts/
│   │       └── setup-knowledge-base.sh
│   └── agents/
│       ├── ba/
│       │   ├── story-writer-amlog/agent.md
│       │   └── kb-updater-amlog/agent.md
│       ├── dev/
│       │   ├── github-manager-amlog/agent.md (+ scripts/commit-and-pr.sh, optional)
│       │   ├── researcher-amlog/agent.md
│       │   ├── security-review-amlog/agent.md
│       │   ├── code-quality-amlog/agent.md + scripts/run-sonarqube.sh
│       │   ├── review-amlog/agent.md
│       │   └── kb-curator-amlog/agent.md + scripts/curate-knowledge.sh
│       ├── frontend-dev/
│       │   ├── planner-amlog/agent.md
│       │   ├── implementor-amlog/agent.md
│       │   └── browser-launcher-amlog/agent.md + scripts/launch-browser.sh
│       ├── backend-dev/
│       │   ├── planner-amlog/agent.md
│       │   ├── implementor-amlog/agent.md
│       │   └── test-runner-amlog/agent.md + scripts/run-affected-tests.sh
│       └── qa/
│           ├── test-generator-amlog/agent.md
│           └── test-executor-amlog/agent.md + scripts/run-test-suite.sh
├── amlog-workflow.config.example.json
└── README.md
```

Note both `implementor-amlog` folders exist side by side under different
`type` parents (`frontend-dev/implementor-amlog/` and
`backend-dev/implementor-amlog/`) — same folder name, different path, which
is how the same agent name can carry two different `type` values without
a filename collision.

---

## 10. `registry/manifest.json` schema

```json
{
  "agents": [
    {
      "name": "implementor-amlog",
      "type": "frontend-dev",
      "stage": "build",
      "description": "Implements the planned Angular front-end changes.",
      "path": "agents/frontend-dev/implementor-amlog"
    },
    {
      "name": "implementor-amlog",
      "type": "backend-dev",
      "stage": "build",
      "description": "Implements the planned .NET back-end changes.",
      "path": "agents/backend-dev/implementor-amlog"
    }
  ]
}
```

`path` is relative to `registry/` and points at the folder to copy
wholesale (containing `agent.md` and optionally `scripts/`) — the CLI
should not need per-file logic, just a recursive folder copy per matched
entry.

---

## 11. `amlog-workflow.config.example.json`

Ship this at the package root so `amlog install` can offer to copy it into
a workspace that doesn't have one yet:

```json
{
  "adapter": "codegraph",
  "zones": {
    "frontend": "./frontend",
    "backend": "./backend",
    "database": "./database"
  },
  "businessDocs": "./docs/business",
  "output": "./.knowledge-graph"
}
```

---

## 12. Acceptance checklist

Before considering the build done, confirm:

- [ ] `curl ... install.sh | sh` and `irm ... install.ps1 | iex` both put
      `amlog` on PATH without requiring Node.
- [ ] `npx amlog-workflow` runs the interactive installer without a global
      install.
- [ ] `amlog install --frontend` in an empty test repo produces
      `.amlog/agents/frontend-dev/` and `.amlog/agents/dev/` only — no
      `backend-dev` or `qa` agents present.
- [ ] The same command also installs CodeGraph if missing, and runs
      `codegraph init` against whatever zones are declared (or the repo
      root if no config file exists).
- [ ] `amlog install --backend` in the same repo, run afterward, adds
      `backend-dev/` alongside the existing `frontend-dev/` without
      duplicating or breaking the `dev/` folder already present.
- [ ] Both `implementor-amlog` folders exist independently
      (`frontend-dev/implementor-amlog/` and
      `backend-dev/implementor-amlog/`) and `amlog list` shows both as
      separate entries with the same name but different `type`.
- [ ] `amlog uninstall` removes `.amlog/` cleanly; `--keep-knowledge-base`
      leaves `.codegraph/` and `.knowledge-graph/` untouched.
- [ ] `amlog status` reports real CodeGraph index stats (symbol/edge
      counts), not placeholder text.
- [ ] Every `agent.md` conforms to the Section 8 frontmatter shape and
      references its `scripts/` file(s) by relative path rather than
      inlining script logic.

---

## 13. Pipeline & Usage
- Create a github workflow to publish the package with sucessfull push to the main branch
- Create Readme.md file with total usages guidlines.
- At the end of the Readme.md add a section how to contribute (e.g: fork the repo and create a PR or something else)

## Appendix A — reference knowledge-base bootstrap script

Known-working version to port into `src/lib/knowledge-base.js` /
`registry/knowledge-base-setup/scripts/setup-knowledge-base.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="amlog-workflow.config.json"
REPO_ROOT="$(pwd)"
log() { echo "[kb-setup] $*"; }

if command -v codegraph >/dev/null 2>&1; then
  log "CodeGraph CLI already installed."
  codegraph upgrade --check || true
else
  log "CodeGraph CLI not found. Installing..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh
  elif command -v npm >/dev/null 2>&1; then
    npm i -g @colbymchenry/codegraph
  else
    log "ERROR: neither curl nor npm available. Aborting."; exit 1
  fi
fi

log "Wiring CodeGraph into detected agent CLIs..."
codegraph install --target=auto --location=global --yes || true

declare -a ZONE_PATHS=()
if [ -f "$CONFIG_FILE" ]; then
  if command -v jq >/dev/null 2>&1; then
    while IFS= read -r p; do ZONE_PATHS+=("$p"); done < <(jq -r '.zones // {} | to_entries[] | .value' "$CONFIG_FILE")
  else
    while IFS= read -r p; do ZONE_PATHS+=("$p"); done < <(python3 -c "
import json
with open('$CONFIG_FILE') as f: cfg = json.load(f)
for v in cfg.get('zones', {}).values(): print(v)
")
  fi
else
  ZONE_PATHS=(".")
fi

for zone in "${ZONE_PATHS[@]}"; do
  target="$REPO_ROOT/$zone"
  [ -d "$target" ] || { log "WARNING: zone '$zone' missing, skipping."; continue; }
  log "Indexing zone: $zone"
  (cd "$target" && codegraph init) || log "WARNING: init failed for '$zone'."
done

log "Done."
for zone in "${ZONE_PATHS[@]}"; do
  target="$REPO_ROOT/$zone"
  [ -d "$target" ] || continue
  echo "--- $zone ---"
  (cd "$target" && codegraph status) || true
done
```
