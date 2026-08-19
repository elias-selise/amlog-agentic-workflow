'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

const REGISTRY_DIR = path.join(__dirname, '../../registry');

/**
 * Copy a single agent's folder into the workspace.
 *
 * @param {object} agent       - agent manifest entry {name, type, stage, path}
 * @param {string} workspaceDir - absolute path to the target workspace
 * @returns {string} destination path
 */
async function copyAgent(agent, workspaceDir) {
  const src = path.join(REGISTRY_DIR, agent.path);
  const dest = path.join(workspaceDir, '.amlog', 'agents', agent.type, agent.name);

  if (!fs.existsSync(src)) {
    throw new Error(`Agent source not found: ${src}`);
  }

  await fs.copy(src, dest, { overwrite: true });
  return dest;
}

/**
 * Copy all matched agents into the workspace.
 *
 * @param {object[]} agents     - filtered agent list from manifest
 * @param {string} workspaceDir - absolute path to workspace
 * @returns {object[]} results with {agent, dest} pairs
 */
async function copyAgents(agents, workspaceDir) {
  const results = [];

  for (const agent of agents) {
    try {
      const dest = await copyAgent(agent, workspaceDir);
      results.push({ agent, dest, ok: true });
    } catch (err) {
      results.push({ agent, dest: null, ok: false, error: err.message });
    }
  }

  return results;
}

/**
 * Return a list of {type, name} for agents already installed in the workspace.
 *
 * @param {string} workspaceDir
 * @returns {object[]}
 */
function getInstalledAgents(workspaceDir) {
  const agentsRoot = path.join(workspaceDir, '.amlog', 'agents');
  if (!fs.existsSync(agentsRoot)) return [];

  const installed = [];
  const types = fs.readdirSync(agentsRoot).filter(f =>
    fs.statSync(path.join(agentsRoot, f)).isDirectory()
  );

  for (const type of types) {
    const typeDir = path.join(agentsRoot, type);
    const agents = fs.readdirSync(typeDir).filter(f =>
      fs.statSync(path.join(typeDir, f)).isDirectory()
    );
    for (const name of agents) {
      installed.push({ type, name });
    }
  }

  return installed;
}

/**
 * Return the unique agent types currently installed.
 *
 * @param {string} workspaceDir
 * @returns {string[]}
 */
function getInstalledTypes(workspaceDir) {
  const agentsRoot = path.join(workspaceDir, '.amlog', 'agents');
  if (!fs.existsSync(agentsRoot)) return [];
  return fs.readdirSync(agentsRoot).filter(f =>
    fs.statSync(path.join(agentsRoot, f)).isDirectory()
  );
}

module.exports = { copyAgent, copyAgents, getInstalledAgents, getInstalledTypes };
