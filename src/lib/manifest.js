'use strict';

const path = require('path');
const fs = require('fs-extra');
const { TOOL_IDS } = require('./adapters');
const { TOOL_IDS } = require('./adapters');

const MANIFEST_PATH = path.join(__dirname, '../../registry/manifest.json');

/**
 * Load the full agent manifest.
 * @returns {object} manifest
 */
function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found at ${MANIFEST_PATH}`);
  }
  return fs.readJsonSync(MANIFEST_PATH);
}

/**
 * Resolve role flags/options into a list of agent type strings.
 * The cross-cutting "dev" type is always included when any role is selected.
 *
 * @param {object} opts  - commander options object
 * @returns {string[]}   - deduplicated array of type names
 */
function resolveTargetTypes(opts) {
  const types = new Set();

  if (opts.all) {
    return ['ba', 'frontend-dev', 'backend-dev', 'qa', 'dev'];
  }

  if (opts.frontend) { types.add('frontend-dev'); types.add('dev'); }
  if (opts.backend)  { types.add('backend-dev');  types.add('dev'); }
  if (opts.qa)       { types.add('qa');            types.add('dev'); }
  if (opts.ba)       { types.add('ba'); }

  if (opts.target) {
    opts.target.split(',').map(t => t.trim()).filter(Boolean).forEach(t => types.add(t));
  }

  return [...types];
}

/**
 * Filter the manifest agents list by target types.
 *
 * @param {string[]} targetTypes
 * @returns {object[]} filtered agents
 */
function filterAgents(targetTypes) {
  const manifest = loadManifest();
  return manifest.agents.filter(a => targetTypes.includes(a.type));
}

/**
 * All distinct agent `type` values present in the manifest, e.g. for
 * offering valid choices when a `--target` value matches nothing.
 *
 * @returns {string[]}
 */
function getKnownTypes() {
  const manifest = loadManifest();
  return [...new Set(manifest.agents.map(a => a.type))];
}

/**
 * Resolve tool flags/options into a list of adapter tool ids.
 *
 * @param {object} opts - commander options object
 * @returns {string[]} deduplicated array of tool ids, e.g. ['claude', 'codex']
 */
function resolveTargetTools(opts) {
  const tools = new Set();

  for (const toolId of TOOL_IDS) {
    if (opts[toolId]) tools.add(toolId);
  }

  if (opts.tools) {
    opts.tools.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tools.add(t));
  }

  return [...tools];
}

module.exports = { loadManifest, resolveTargetTypes, filterAgents, resolveTargetTools, getKnownTypes };
