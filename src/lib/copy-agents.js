'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const { parseFrontmatter, rewriteScriptPaths } = require('./frontmatter');
const { getAdapter } = require('./adapters');
const { mergeState, readState, writeState } = require('./state');
const { syncRouterSections, removeRouterSections } = require('./router');

const REGISTRY_DIR = path.join(__dirname, '../../registry');
const SKILLS_DIR = path.join(REGISTRY_DIR, 'skills');

/**
 * Resolve the native filename (without extension) for an agent, suffixing
 * with the role type when the manifest has more than one agent sharing the
 * same `name` (e.g. `github-manager-amlog` under both `ba` and `dev`) — flat
 * per-tool namespaces would otherwise silently overwrite one with the other.
 *
 * @param {object[]} agents - full manifest agent list (unfiltered)
 * @param {object} agent    - the agent being resolved
 * @returns {string}
 */
function resolveFileBase(agents, agent) {
  const sameName = agents.filter((a) => a.name === agent.name);
  return sameName.length > 1 ? `${agent.name}--${agent.type}` : agent.name;
}

/**
 * Copy an agent's companion scripts/ folder (if any) into `.amlog/scripts/<name>/`.
 *
 * @param {object} agent
 * @param {string} workspaceDir
 */
async function copyScripts(agent, workspaceDir) {
  const scriptsSrc = path.join(REGISTRY_DIR, agent.path, 'scripts');
  if (!fs.existsSync(scriptsSrc)) return;
  const scriptsDest = path.join(workspaceDir, '.amlog', 'scripts', agent.name);
  await fs.copy(scriptsSrc, scriptsDest, { overwrite: true });
}

/**
 * Copy any skill(s) an agent declares (`skills:` frontmatter) into
 * `.amlog/skills/<skill-id>/`, shared across every agent that references it.
 *
 * @param {string[]|undefined} skillIds
 * @param {string} workspaceDir
 */
async function copySkills(skillIds, workspaceDir) {
  if (!Array.isArray(skillIds)) return;
  for (const skillId of skillIds) {
    const skillSrc = path.join(SKILLS_DIR, skillId);
    if (!fs.existsSync(skillSrc)) continue;
    const skillDest = path.join(workspaceDir, '.amlog', 'skills', skillId);
    await fs.copy(skillSrc, skillDest, { overwrite: true });
  }
}

/**
 * Install the given agents into the workspace for each selected tool,
 * converting the shared `agent.md` into every tool's native format.
 *
 * @param {object[]} agents      - filtered agent list from the manifest
 * @param {string[]} tools       - selected tool ids (e.g. ['claude', 'codex'])
 * @param {string} workspaceDir  - absolute path to the workspace
 * @param {object[]} allAgents   - full unfiltered manifest agent list, for collision detection
 * @returns {object[]} results with {agent, tool, dest, ok} entries
 */
async function installAgents(agents, tools, workspaceDir, allAgents = agents) {
  const results = [];
  const stateRecords = [];

  for (const agent of agents) {
    const src = path.join(REGISTRY_DIR, agent.path, 'agent.md');
    let meta;
    let body;
    try {
      if (!fs.existsSync(src)) throw new Error(`Agent source not found: ${src}`);
      const raw = await fs.readFile(src, 'utf8');
      ({ meta, body } = parseFrontmatter(raw));
      body = rewriteScriptPaths(body, agent.name);
    } catch (err) {
      for (const toolId of tools) {
        results.push({ agent, tool: toolId, dest: null, ok: false, error: err.message });
      }
      continue;
    }

    const fileBase = resolveFileBase(allAgents, agent);

    for (const toolId of tools) {
      try {
        const adapter = getAdapter(toolId);
        const dest = await adapter.write(fileBase, meta, body, workspaceDir);
        await copyScripts(agent, workspaceDir);
        await copySkills(meta.skills, workspaceDir);
        results.push({ agent, tool: toolId, dest, ok: true });
        stateRecords.push({ tool: toolId, type: agent.type, name: agent.name, fileBase });
      } catch (err) {
        results.push({ agent, tool: toolId, dest: null, ok: false, error: err.message });
      }
    }
  }

  const { installs } = mergeState(workspaceDir, stateRecords);
  // Refresh the routing section so the main session knows every installed
  // agent (and picks one without the user naming it).
  syncRouterSections(workspaceDir, installs);
  return results;
}

/**
 * Remove every agent recorded in `.amlog/state.json` from its native tool
 * location, then clear the state file.
 *
 * @param {string} workspaceDir
 */
async function uninstallAgents(workspaceDir) {
  const { installs } = readState(workspaceDir);
  for (const rec of installs) {
    try {
      const adapter = getAdapter(rec.tool);
      await adapter.remove(rec.fileBase, workspaceDir);
    } catch (err) {
      console.log(chalk.yellow(`  WARNING: failed to remove ${rec.tool}/${rec.name}: ${err.message}`));
    }
  }
  writeState(workspaceDir, []);
  removeRouterSections(workspaceDir);
  return installs;
}

/**
 * Return the list of {tool, type, name} currently recorded as installed.
 *
 * @param {string} workspaceDir
 * @returns {object[]}
 */
function getInstalledAgents(workspaceDir) {
  return readState(workspaceDir).installs;
}

/**
 * Return the unique role types currently installed (across any tool).
 *
 * @param {string} workspaceDir
 * @returns {string[]}
 */
function getInstalledTypes(workspaceDir) {
  return [...new Set(getInstalledAgents(workspaceDir).map((a) => a.type))];
}

/**
 * Return the unique tool ids currently installed (across any role).
 *
 * @param {string} workspaceDir
 * @returns {string[]}
 */
function getInstalledTools(workspaceDir) {
  return [...new Set(getInstalledAgents(workspaceDir).map((a) => a.tool))];
}

module.exports = {
  installAgents,
  uninstallAgents,
  getInstalledAgents,
  getInstalledTypes,
  getInstalledTools,
  resolveFileBase,
};
