---
name: knowledge-base-setup
type: dev
stage: platform
description: Installs and initializes CodeGraph for the workspace knowledge graph.
tools: [Bash, Read]
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
This is a platform/one-time setup step, not part of the per-issue pipeline (it doesn't appear in the agent-flow diagram in README.md) — it just gets `.codegraph` ready before any other agent runs `codegraph_explore`. There is no automatic next agent: once every zone reports indexed successfully, this session ends. The per-issue cycle starts separately and later, whenever a developer/BA kicks it off (e.g. `story-writer-amlog` for a new story, or `github-manager-amlog` (`dev`) once a developer says "let's work with issue #<n>").

If any zone failed to index, do not claim success — report exactly which zone(s) failed and why, so the failure isn't silently lost.
