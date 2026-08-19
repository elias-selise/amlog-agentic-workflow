---
name: knowledge-base-setup
type: dev
stage: platform
description: Installs and initializes CodeGraph for the workspace knowledge graph.
tools: [bash, read]
---

# Knowledge Base Setup

## Purpose
Ensure CodeGraph is installed, wired into agent CLIs, and all workspace zones are indexed so every other agent has a live, queryable knowledge graph to work from.

## Instructions
1. Check whether `codegraph` is available on PATH by running `codegraph --version`.
2. If not installed, run `scripts/setup-knowledge-base.sh` to install it via curl or npm fallback.
3. Run `codegraph upgrade --check` to note any available updates (do not force-upgrade).
4. Run `codegraph install --target=auto --location=global --yes` to wire the MCP server into detected agent CLIs.
5. Look for `amlog-workflow.config.json` at the repo root; if present, read `.zones` and run `codegraph init` inside each zone path.
6. If no config file exists, run `codegraph init` at the repo root and suggest adding a config.
7. Run `codegraph status` for each indexed zone and print the symbol/edge counts.
8. Report success or failure for each zone clearly.

## Handoff
Once knowledge base is indexed, hand off to `planner-amlog` (frontend or backend) or `researcher-amlog` for planning.
