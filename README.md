# amlog-workflow

**Agentic SDLC workflow toolkit** — installs role-specific AI agents and a [CodeGraph](https://github.com/colbymchenry/codegraph) knowledge base into any workspace, in one command.

[![npm version](https://img.shields.io/npm/v/amlog-workflow.svg)](https://www.npmjs.com/package/amlog-workflow)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Table of contents

- [What is amlog?](#what-is-amlog)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Upgrading from a pre-native install](#upgrading-from-a-pre-native-install)
- [CLI reference](#cli-reference)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Diagnostics](#diagnostics)
- [Multi-zone repos](#multi-zone-repos-frontend--backend-in-one-repo)
- [Agent roster](#agent-roster)
- [How agents work](#how-agents-work)
- [Status](#status)
- [Requirements](#requirements)
- [License](#license)
- [Contributing](#contributing)

---

## What is amlog?

`amlog` is a CLI that installs a curated set of role-specific AI agents **natively** into whichever AI coding tool(s) you use, alongside a live code-knowledge graph. Each agent is defined once in a shared registry (`registry/`) and converted into the exact subagent format each tool expects — no copy-pasting definitions between tools, no format mismatches, and no hand-maintained prose roster in `AGENTS.md`/`CLAUDE.md`.

In short, one command gives your AI coding assistant(s):
- A set of specialized subagents tuned to your role (planner, implementor, reviewer, test writer, etc.), each with its own scoped instructions and tool access.
- A [CodeGraph](https://github.com/colbymchenry/codegraph) index of your codebase, so agents can look up real call paths and symbol definitions instead of guessing from context.
- Companion shell scripts for agents that need to run something concrete (SonarQube scans, test suites, git/PR automation, etc.).

**Agents are organized by SDLC role:**

| Role | Agents included |
|---|---|
| `--frontend` | planner, implementor (Angular), browser-launcher + all `dev` agents |
| `--backend` | planner, implementor (.NET), test-runner + all `dev` agents |
| `--qa` | test-generator, test-executor |
| `--ba` | story-writer, github-manager-ba |
| `--all` | everything above |

`dev` agents (researcher, security-review, code-quality, review, github-manager, knowledge-base-setup) are cross-cutting and get pulled in automatically alongside `--frontend`, `--backend`, or `--all`.

**And installed for whichever tool(s) you pick:**

| Tool | Flag | Native location | Format |
|---|---|---|---|
| Claude Code | `--claude` | `.claude/agents/<name>.md` | Markdown + YAML frontmatter |
| Codex | `--codex` | `.codex/agents/<name>.toml` | TOML |
| OpenCode | `--opencode` | `.opencode/agent/<name>.md` | Markdown + YAML frontmatter |
| Antigravity | `--antigravity` | `.agents/agents/<name>.md` | Markdown + YAML frontmatter |

You can select more than one tool at once (`--claude --codex`), and installing for a new tool later never re-copies or duplicates agents already installed for another — each tool gets its own native files, tracked independently in `.amlog/state.json`.

> **Note on name collisions:** a few agent names (e.g. `planner-amlog`, `implementor-amlog`) exist under more than one role (`fe` and `be`). Because each native tool folder is flat (one file per name), amlog automatically suffixes the installed filename with the role whenever both are selected together — e.g. `planner-amlog--fe.md` and `planner-amlog--be.md` side by side, each with a matching unique `name:` in its frontmatter so the host tool never sees a duplicate. You'll only see the plain `<name>.md` when there's no collision for the roles you installed.

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

> **Requires Node.js 18+** — Node is needed for the `npm` install path. The `curl`/`irm` scripts also install via npm under the hood.

Confirm it's on your `PATH`:

```bash
amlog -v
```

### Step 2 — Pick your role

Run this from the root of the repo you want agents installed into:

```bash
cd my-project

amlog install --frontend   # Angular developer
amlog install --backend    # .NET developer
amlog install --qa         # QA engineer
amlog install --ba         # Business Analyst
amlog install --all        # Everyone / every role
```

Prefer explicit control over which agent *types* get pulled in? Use `--target` instead of a role shorthand:

```bash
amlog install --target fe,qa
```

### Step 3 — Pick your tool(s)

Add one or more tool flags to the same command, or omit them entirely to get an interactive multi-select prompt:

```bash
amlog install --frontend --claude                # Claude Code only
amlog install --frontend --claude --codex        # Claude Code + Codex, in one pass
amlog install --backend --tools=opencode,antigravity
```

That's it. After this command:
- Agents are installed **natively** into each selected tool's own folder (see the table above) — the tool discovers and invokes them itself, no extra wiring needed.
- Companion scripts some agents ship with live in `.amlog/scripts/<agent-name>/` (gitignored), referenced by relative path from the agent's instructions.
- A small `.amlog/state.json` (also gitignored) tracks which roles/tools are installed, so `amlog status`, `amlog update`, and `amlog uninstall` know what to manage.
- CodeGraph is installed and your codebase is indexed.
- `.amlog/`, `.codegraph/`, and `.knowledge-graph/` are added to your `.gitignore` automatically.

---

## Quick start

The fastest path for a brand-new workspace, installing everything for Claude Code:

```bash
npm i -g amlog-workflow
cd my-project
amlog install --all --claude --yes
```

Or skip every flag and just run `amlog` with no arguments — it walks you through role and tool selection interactively:

```bash
amlog
```

Once it finishes, check what landed:

```bash
amlog status
```

---

## Upgrading from a pre-native install

Older versions of `amlog` installed every agent as generic markdown under a shared `.amlog/agents/<type>/<name>/` tree, and embedded the roster as prose into `AGENTS.md`/`CLAUDE.md`. If your workspace still has that layout, the **next** `amlog install` or `amlog update` you run will detect it automatically, show you exactly what it's about to remove, and (after a confirmation, unless you pass `--yes`):

- Delete the old `.amlog/agents/` tree.
- Strip just the `<!-- amlog:start --> … <!-- amlog:end -->` section it added to your instruction file, leaving everything else in that file untouched.

Nothing else changes — run the command with your usual role + tool flags right after, and agents get installed the new, native way.

---

## CLI reference

```
amlog                          Interactive installer (prompts for role, then tool)
amlog install [flags]          Install agents natively for the selected tool(s) + bootstrap knowledge base
amlog update [flags]           Refresh installed roles/tools to latest definitions
amlog uninstall [flags]        Remove agents (and optionally the knowledge base) from this workspace
amlog upgrade [version]        Update the amlog CLI itself
amlog list                     Show every agent in the registry, with type/stage
amlog status                   Show installed agents (by tool + role) + CodeGraph index status
amlog doctor                   Diagnose the local environment + detect a legacy .amlog/agents/ install
amlog -v, --version            Print installed CLI version
amlog -h, --help               Show help (also works per-subcommand, e.g. `amlog install --help`)
```

### `amlog install`

Installs agents into the current workspace and bootstraps CodeGraph. Any role/tool flag can be omitted — you'll be prompted interactively for whichever piece is missing.

| Flag | Description |
|---|---|
| `--frontend` | Shorthand for `--target=fe,dev` |
| `--backend` | Shorthand for `--target=be,dev` |
| `--qa` | Shorthand for `--target=qa` |
| `--ba` | Shorthand for `--target=ba` |
| `--all` | All roles |
| `--target <csv>` | Explicit types: `fe,be,qa,ba,dev` |
| `--claude` | Install native Claude Code subagents (`.claude/agents/`) |
| `--codex` | Install native Codex subagents (`.codex/agents/`) |
| `--opencode` | Install native OpenCode subagents (`.opencode/agent/`) |
| `--antigravity` | Install native Antigravity subagents (`.agents/agents/`) |
| `--tools <csv>` | Explicit tool ids: `claude,codex,opencode,antigravity` |
| `--yes` | Skip all confirmation/interactive prompts |
| `--location <scope>` | Where CLI config lives: `global` \| `local` (default: `global`) |

Role flags and tool flags combine freely — e.g. `amlog install --backend --qa --claude --codex` installs both roles for both tools in one pass.

### `amlog update`

Re-resolves whichever roles/tools are already recorded in `.amlog/state.json` and re-pulls the latest agent definitions for them — no flags needed for the common case.

| Flag | Description |
|---|---|
| `--yes` | Skip confirmation prompts |

### `amlog uninstall`

Removes every agent recorded in `.amlog/state.json` from its native tool location(s), then clears the state file.

| Flag | Description |
|---|---|
| `--keep-knowledge-base` | Remove agents only, keep `.codegraph/` and `.knowledge-graph/` |
| `--yes` | Skip confirmation prompts |

### `amlog upgrade [version]`

Updates the `amlog` CLI itself (not the agents in a given workspace). Pass a specific version to pin to it; omit it to move to latest.

### `amlog list`

Prints every agent in the registry with its name, type, and stage — useful for picking a `--target` value or just seeing what's available before installing.

### `amlog status`

Shows installed agents grouped by tool then role, whether CodeGraph is wired for each installed tool, and live CodeGraph index stats (files, symbols, edges) per zone.

### `amlog doctor`

Diagnoses the local environment: Node.js version and platform, the resolved CodeGraph command/path (and whether it's reachable and wired for each installed tool), which agent-instruction file was detected (`AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `CURSOR.md`), whether `.amlog/state.json` exists, and whether a legacy `.amlog/agents/` tree still needs migrating. Run this first when something looks off after install.

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

## Diagnostics

If `/agents` (or your tool's equivalent) doesn't show what you expect after install, or CodeGraph doesn't seem to be wired up, run:

```bash
amlog doctor
```

and check `amlog status` for a full breakdown of what's actually recorded as installed. Both commands are read-only and safe to run anytime.

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

If you don't create this file, `amlog install` will detect a plausible multi-zone layout on its own (when it finds ≥2 candidate zone directories) and offer to write one for you interactively.

---

## Agent roster

| Name | Type | Stage | Has script |
|---|---|---|---|
| `knowledge-base-setup` | `dev` | platform | ✅ `setup-knowledge-base.sh` |
| `story-writer-amlog` | `ba` | ba | — |
| `github-manager-ba-amlog` | `ba` | ba | — |
| `github-manager-amlog` | `dev` | cross-cutting | ✅ `commit-and-pr.sh` |
| `researcher-amlog` | `dev` | planning | — |
| `security-review-amlog` | `dev` | build | — |
| `code-quality-amlog` | `dev` | build | ✅ `run-sonarqube.sh` |
| `review-amlog` | `dev` | build | — |
| `planner-amlog` | `fe` | planning | — |
| `implementor-amlog` | `fe` | build | — |
| `browser-launcher-amlog` | `fe` | build | ✅ `launch-browser.sh` |
| `planner-amlog` | `be` | planning | — |
| `implementor-amlog` | `be` | build | — |
| `test-runner-amlog` | `be` | build | ✅ `run-affected-tests.sh` |
| `test-generator-amlog` | `qa` | qa | — |
| `test-executor-amlog` | `qa` | qa | ✅ `run-test-suite.sh` |

Run `amlog list` anytime to see this same roster pulled live from the registry.

---

## How agents work

Each agent is defined once in the shared registry (`registry/agents/<type>/<agent-name>/agent.md`) as a markdown file with YAML frontmatter (`name`, `type`, `stage`, `description`, `tools`) — the source of truth `amlog` converts from. Example:

```yaml
---
name: implementor-amlog
type: fe
stage: build
description: Implements the planned Angular front-end changes.
tools: [read, write, edit, bash, codegraph_explore]
---
```

`amlog install` converts that definition into **each selected tool's own native format and folder** (see the table in [What is amlog?](#what-is-amlog)), so the tool discovers and can invoke it itself — no manual `@`-referencing needed. Exact invocation syntax is each tool's own (check its docs); roughly:

```bash
# Claude Code — auto-discovers .claude/agents/*.md as project subagents
claude "delegate this to implementor-amlog"

# Codex — auto-discovers .codex/agents/*.toml
codex "spawn implementor-amlog to build this"
# Claude Code — auto-discovers .claude/agents/*.md as project subagents
claude "delegate this to implementor-amlog"

# Codex — auto-discovers .codex/agents/*.toml
codex "spawn implementor-amlog to build this"

# OpenCode — auto-discovers .opencode/agent/*.md
opencode run --agent implementor-amlog "..."

# Antigravity — auto-discovers .agents/agents/*.md
agy --agent implementor-amlog "..."
```

Any companion shell script an agent ships with (e.g. `run-test-suite.sh`) is copied to `.amlog/scripts/<agent-name>/` once per workspace, and every native agent file references it there — regardless of which tool(s) you installed for.

---

## Status

```bash
amlog status
```

Shows:
- Which agents are installed, grouped by tool and then by role
- Whether CodeGraph is installed and wired for each installed tool
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
