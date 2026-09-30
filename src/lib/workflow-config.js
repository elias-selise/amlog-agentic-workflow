'use strict';

const path = require('path');
const fs = require('fs-extra');

const CONFIG_NAME = 'amlog-workflow.config.json';
// Lives under `.amlog/` with the rest of amlog's files.
const CONFIG_FILE = path.join('.amlog', CONFIG_NAME);
// Pre-`.amlog/` location, still read (and migrated on the next write).
const LEGACY_CONFIG_FILE = CONFIG_NAME;

// Handoff defaults: agents ask before every handoff unless the user opts in,
// and the same handoff for the same issue pauses for a human on its 3rd repeat.
const DEFAULT_AUTO_HANDOVER = false;
const DEFAULT_MAX_HANDOFF_REPEATS = 3;

function configPath(workspaceDir) {
  return path.join(workspaceDir, CONFIG_FILE);
}

/** Path to read from: the `.amlog/` config, else a legacy root-level one. */
function resolveReadPath(workspaceDir) {
  const p = configPath(workspaceDir);
  const legacy = path.join(workspaceDir, LEGACY_CONFIG_FILE);
  return !fs.existsSync(p) && fs.existsSync(legacy) ? legacy : p;
}

/**
 * Read `.amlog/amlog-workflow.config.json`. Returns `{}` when absent or unparseable.
 *
 * @param {string} workspaceDir
 * @returns {object}
 */
function readWorkflowConfig(workspaceDir) {
  const p = resolveReadPath(workspaceDir);
  if (!fs.existsSync(p)) return {};
  try {
    return fs.readJsonSync(p) || {};
  } catch {
    return {};
  }
}

/**
 * Merge `patch` into the config file (creating it if needed), keeping every
 * existing key (`zones`, `adapter`, ...) intact.
 *
 * @param {string} workspaceDir
 * @param {object} patch
 * @returns {object} the merged config
 */
function updateWorkflowConfig(workspaceDir, patch) {
  const merged = { ...readWorkflowConfig(workspaceDir), ...patch };
  fs.outputJsonSync(configPath(workspaceDir), merged, { spaces: 2 });
  fs.removeSync(path.join(workspaceDir, LEGACY_CONFIG_FILE));
  return merged;
}

/**
 * Zone paths the user has actually filled in. The default config lists the
 * usual zone names with `null` values as placeholders; those are skipped.
 *
 * @param {object} cfg - parsed workflow config
 * @returns {string[]}
 */
function activeZones(cfg) {
  return Object.values((cfg && cfg.zones) || {})
    .filter((v) => typeof v === 'string' && v.trim() !== '');
}

/**
 * Resolve the handoff settings agents follow, falling back to defaults for
 * missing or malformed values.
 *
 * @param {string} workspaceDir
 * @returns {{ autoHandover: boolean, maxHandoffRepeats: number }}
 */
function getHandoffSettings(workspaceDir) {
  const cfg = readWorkflowConfig(workspaceDir);
  const autoHandover = typeof cfg.auto_handover === 'boolean' ? cfg.auto_handover : DEFAULT_AUTO_HANDOVER;
  const max = Number(cfg.max_handoff_repeats);
  const maxHandoffRepeats = Number.isInteger(max) && max >= 1 ? max : DEFAULT_MAX_HANDOFF_REPEATS;
  return { autoHandover, maxHandoffRepeats };
}

module.exports = {
  CONFIG_FILE,
  LEGACY_CONFIG_FILE,
  DEFAULT_AUTO_HANDOVER,
  DEFAULT_MAX_HANDOFF_REPEATS,
  configPath,
  readWorkflowConfig,
  activeZones,
  updateWorkflowConfig,
  getHandoffSettings,
};
