'use strict';

const path = require('path');
const fs = require('fs-extra');

const CONFIG_FILE = 'amlog-workflow.config.json';

// Handoff defaults: agents ask before every handoff unless the user opts in,
// and the same handoff for the same issue pauses for a human on its 3rd repeat.
const DEFAULT_AUTO_HANDOVER = false;
const DEFAULT_MAX_HANDOFF_REPEATS = 3;

function configPath(workspaceDir) {
  return path.join(workspaceDir, CONFIG_FILE);
}

/**
 * Read `amlog-workflow.config.json`. Returns `{}` when absent or unparseable.
 *
 * @param {string} workspaceDir
 * @returns {object}
 */
function readWorkflowConfig(workspaceDir) {
  const p = configPath(workspaceDir);
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
  return merged;
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
  DEFAULT_AUTO_HANDOVER,
  DEFAULT_MAX_HANDOFF_REPEATS,
  configPath,
  readWorkflowConfig,
  updateWorkflowConfig,
  getHandoffSettings,
};
