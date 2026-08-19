# amlog-workflow

**Agentic SDLC workflow toolkit** — installs role-specific AI agents and a [CodeGraph](https://github.com/colbymchenry/codegraph) knowledge base into any workspace, in one command.

[![npm version](https://img.shields.io/npm/v/amlog-workflow.svg)](https://www.npmjs.com/package/amlog-workflow)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What is amlog?

`amlog` is a CLI that installs a curated set of role-specific AI agents into your project alongside a live code-knowledge graph. Each agent is a self-contained markdown definition that any AI coding assistant (Gemini, Claude, Cursor, etc.) can pick up and execute.

**Agents are organized by SDLC role:**

| Role | Agents included |
|---|---|
| `--frontend` | planner, implementor (Angular), browser-launcher + all `dev` agents |
| `--backend` | planner, implementor (.NET), test-runner + all `dev` agents |
| `--qa` | test-generator, test-executor |
| `--ba` | story-writer, kb-updater |
| `--all` | everything above |

Every install also bootstraps [CodeGraph](https://github.com/colbymchenry/codegraph) so agents have a real, queryable knowledge graph of your codebase from day one.

---

## Installation

### Step 1 — Install the CLI (once per machine)

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/selise/amlog-agentic-workflow/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/selise/amlog-agentic-workflow/main/install.ps1 | iex

# Already have Node.js 18+?
npm i -g amlog-workflow

# Or run without installing
npx amlog-workflow
```

> **Requires Node.js 18+** — Node is needed for the `npm` install path. The `curl`/`irm` path will also install via npm for v1.

### Step 2 — Pull agents into your workspace

```bash
cd my-project

amlog install --frontend   # Angular developer
amlog install --backend    # .NET developer
amlog install --qa         # QA engineer
amlog install --ba         # Business Analyst
amlog install --all        # Everyone
```

That's it. After this command:
- Agent definitions are in `.amlog/agents/`
- Your `AGENTS.md` (or `CLAUDE.md`) is updated with the agent list
- CodeGraph is installed and your codebase is indexed

---

## CLI Reference

```
amlog                          Interactive installer (prompts for role)
amlog install [flags]          Install agents + bootstrap knowledge base
amlog update                   Refresh installed roles to latest definitions
amlog uninstall [flags]        Remove agents (and optionally the KB) from this workspace
amlog upgrade [version]        Update the amlog CLI itself
amlog list                     Show every agent in the registry
amlog status                   Show installed agents + CodeGraph index stats
amlog version                  Print installed CLI version
```

### Flags

| Flag | Applies to | Description |
|---|---|---|
| `--frontend` | install | Shorthand for `--target=frontend-dev,dev` |
| `--backend` | install | Shorthand for `--target=backend-dev,dev` |
| `--qa` | install | Shorthand for `--target=qa` |
| `--ba` | install | Shorthand for `--target=ba` |
| `--all` | install | All roles |
| `--target <csv>` | install, update | Explicit types: `frontend-dev,backend-dev,qa,ba,dev` |
| `--yes` | install, uninstall | Skip confirmation prompts |
| `--location <scope>` | install | `global` \| `local` (default: `global`) |
| `--keep-knowledge-base` | uninstall | Remove agents only, keep `.codegraph/` and `.knowledge-graph/` |

---

## Updating

```bash
# Update agents in this workspace to the latest definitions
amlog update

# Update the amlog CLI itself
amlog upgrade
amlog upgrade 1.2.0   # pin to a specific version
```

---

## Uninstalling

```bash
# Remove agents and knowledge base from this workspace
amlog uninstall

# Remove agents only (keep the CodeGraph index)
amlog uninstall --keep-knowledge-base
```

---

## Multi-zone repos (frontend + backend in one repo)

Add an `amlog-workflow.config.json` at your repo root to tell amlog (and CodeGraph) how to index each zone independently:

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

Copy the example file to get started:

```bash
cp node_modules/amlog-workflow/amlog-workflow.config.example.json ./amlog-workflow.config.json
```

---

## Agent roster

| Name | Type | Stage | Has script |
|---|---|---|---|
| `knowledge-base-setup` | `dev` | platform | ✅ `setup-knowledge-base.sh` |
| `story-writer-amlog` | `ba` | ba | — |
| `kb-updater-amlog` | `ba` | ba | — |
| `github-manager-amlog` | `dev` | cross-cutting | ✅ `commit-and-pr.sh` |
| `researcher-amlog` | `dev` | planning | — |
| `security-review-amlog` | `dev` | build | — |
| `code-quality-amlog` | `dev` | build | ✅ `run-sonarqube.sh` |
| `review-amlog` | `dev` | build | — |
| `kb-curator-amlog` | `dev` | platform | ✅ `curate-knowledge.sh` |
| `planner-amlog` | `frontend-dev` | planning | — |
| `implementor-amlog` | `frontend-dev` | build | — |
| `browser-launcher-amlog` | `frontend-dev` | build | ✅ `launch-browser.sh` |
| `planner-amlog` | `backend-dev` | planning | — |
| `implementor-amlog` | `backend-dev` | build | — |
| `test-runner-amlog` | `backend-dev` | build | ✅ `run-affected-tests.sh` |
| `test-generator-amlog` | `qa` | qa | — |
| `test-executor-amlog` | `qa` | qa | ✅ `run-test-suite.sh` |

---

## How agents work

Each agent is a markdown file with YAML frontmatter. Any AI agent CLI can read it and execute its instructions. Example frontmatter:

```yaml
---
name: implementor-amlog
type: frontend-dev
stage: build
description: Implements the planned Angular front-end changes.
tools: [read, write, edit, bash, codegraph_explore]
---
```

Agents are installed into `.amlog/agents/<type>/<name>/agent.md` in your workspace. To invoke an agent, point your AI CLI at the agent file:

```bash
# Gemini / Antigravity
agy @.amlog/agents/frontend-dev/implementor-amlog/agent.md "Implement story #42"

# Claude
claude @.amlog/agents/backend-dev/planner-amlog/agent.md "Plan story #42"
```

---

## Status

```bash
amlog status
```

Shows:
- Which agents are installed and their types
- Whether CodeGraph is installed
- Live index stats (files, symbols, edges) per zone

---

## Requirements

| Tool | Required for |
|---|---|
| Node.js ≥ 18 | CLI runtime |
| npm | Install path |
| [CodeGraph](https://github.com/colbymchenry/codegraph) | Auto-installed by `amlog install` |
| [GitHub CLI (`gh`)](https://cli.github.com/) | Optional — enables auto-PR in `github-manager-amlog` |
| SonarQube + `sonar-scanner` | Optional — required by `code-quality-amlog` |

---

## License

MIT © Selise

---

## Contributing

Contributions are welcome! Here's the recommended workflow:

### Option 1 — Fork and PR (preferred for external contributors)

1. **Fork** this repository on GitHub.
2. Clone your fork: `git clone https://github.com/<your-username>/amlog-workflow.git`
3. Create a feature branch: `git checkout -b feat/my-improvement`
4. Make your changes — add a new agent, improve the CLI, fix a bug.
5. Test locally: `npm install && node bin/amlog.js list`
6. Commit with gitmoji: `git commit -m "✨ feat: add my-new-agent"`
7. Push and **open a Pull Request** against `main` on this repo.
8. Describe what you changed and why in the PR body.

### Option 2 — Open an issue first (for larger changes)

For significant new agents or CLI behaviour changes, please **open an issue** to discuss the design before writing code. This avoids wasted effort if the direction doesn't fit the roadmap.

### Adding a new agent

1. Create a folder under `registry/agents/<type>/<agent-name>/`.
2. Write `agent.md` using the frontmatter schema from the spec.
3. Add a `scripts/` subfolder only if the agent needs a shell script.
4. Add the agent entry to `registry/manifest.json`.
5. Submit a PR — include a short description of what the agent does and which role it targets.

### Code style

- Node.js with CommonJS modules (`require`/`module.exports`).
- No build step — the CLI runs directly from source.
- Keep dependencies minimal.
