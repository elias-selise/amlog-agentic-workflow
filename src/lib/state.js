'use strict';

const path = require('path');
const fs = require('fs-extra');

function statePath(workspaceDir) {
  return path.join(workspaceDir, '.amlog', 'state.json');
}

/**
 * Read `.amlog/state.json`. Returns an empty install list when absent.
 *
 * @param {string} workspaceDir
 * @returns {{ installs: {tool: string, type: string, name: string, fileBase: string}[] }}
 */
function readState(workspaceDir) {
  const p = statePath(workspaceDir);
  if (!fs.existsSync(p)) return { installs: [] };
  try {
    const parsed = fs.readJsonSync(p);
    return { installs: Array.isArray(parsed.installs) ? parsed.installs : [] };
  } catch {
    return { installs: [] };
  }
}

/**
 * Merge new install records into state.json (replacing any prior record for
 * the same tool+type+name) and write it back.
 *
 * @param {string} workspaceDir
 * @param {{tool: string, type: string, name: string, fileBase: string}[]} records
 */
function mergeState(workspaceDir, records) {
  const state = readState(workspaceDir);
  const key = (r) => `${r.tool}::${r.type}::${r.name}`;
  const byKey = new Map(state.installs.map((r) => [key(r), r]));
  for (const r of records) byKey.set(key(r), r);
  const merged = { installs: [...byKey.values()] };
  fs.outputJsonSync(statePath(workspaceDir), merged, { spaces: 2 });
  return merged;
}

/**
 * Overwrite state.json wholesale (used by uninstall, after clearing records).
 *
 * @param {string} workspaceDir
 * @param {{tool: string, type: string, name: string, fileBase: string}[]} installs
 */
function writeState(workspaceDir, installs) {
  fs.outputJsonSync(statePath(workspaceDir), { installs }, { spaces: 2 });
}

module.exports = { statePath, readState, mergeState, writeState };
