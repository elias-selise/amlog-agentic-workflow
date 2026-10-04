'use strict';

const path = require('path');
const fs = require('fs-extra');

// The Claude Code activity-capture hook: copied into the workspace and
// registered as a PostToolUse hook so every agent file touch is appended to
// `.amlog/activity/events.ndjson`. See registry/hooks/amlog-activity-hook.js.
const HOOK_SRC = path.join(__dirname, '../../registry/hooks/amlog-activity-hook.js');
const HOOK_SCRIPT_REL = path.join('.amlog', 'hooks', 'amlog-activity-hook.js');

// File tools whose calls we want to observe. Mirrors OP_BY_TOOL in the hook.
const HOOK_MATCHER = 'Read|Write|Edit|MultiEdit|NotebookEdit';
// Command Claude Code runs. Relative to the workspace (Claude runs hooks with
// cwd = project root). Forward slashes work cross-platform for `node <path>`.
const HOOK_COMMAND = `node ${HOOK_SCRIPT_REL.split(path.sep).join('/')}`;

// Identifies our hook entries inside settings.json regardless of how the
// command is spelled, so install is idempotent and uninstall is surgical.
const HOOK_MARKER = 'amlog-activity-hook.js';

function settingsPath(workspaceDir) {
  return path.join(workspaceDir, '.claude', 'settings.json');
}

function hookScriptPath(workspaceDir) {
  return path.join(workspaceDir, HOOK_SCRIPT_REL);
}

function readSettings(workspaceDir) {
  const p = settingsPath(workspaceDir);
  if (!fs.existsSync(p)) return {};
  try {
    const parsed = fs.readJsonSync(p);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isOurCommand(entry) {
  return entry && entry.type === 'command' && typeof entry.command === 'string'
    && entry.command.includes(HOOK_MARKER);
}

/**
 * Does any PostToolUse group already register our activity hook?
 *
 * @param {object} settings - parsed settings.json
 */
function hasActivityHook(settings) {
  const groups = settings && settings.hooks && Array.isArray(settings.hooks.PostToolUse)
    ? settings.hooks.PostToolUse : [];
  return groups.some((g) => Array.isArray(g.hooks) && g.hooks.some(isOurCommand));
}

/**
 * Copy the hook script into the workspace and register it as a Claude Code
 * PostToolUse hook, merging into any existing `.claude/settings.json` without
 * disturbing the user's own settings or hooks. Idempotent.
 *
 * Only meaningful for the Claude adapter — `agent_id`/`agent_type` labelling is
 * Claude-Code-specific — so callers gate this on claude being an installed tool.
 *
 * @param {string} workspaceDir
 * @returns {{installed: boolean, settingsFile: string}}
 */
function installActivityHook(workspaceDir) {
  fs.copySync(HOOK_SRC, hookScriptPath(workspaceDir), { overwrite: true });

  const settings = readSettings(workspaceDir);
  if (hasActivityHook(settings)) {
    return { installed: false, settingsFile: settingsPath(workspaceDir) };
  }

  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = [];
  settings.hooks.PostToolUse.push({
    matcher: HOOK_MATCHER,
    hooks: [{ type: 'command', command: HOOK_COMMAND }],
  });

  fs.outputJsonSync(settingsPath(workspaceDir), settings, { spaces: 2 });
  return { installed: true, settingsFile: settingsPath(workspaceDir) };
}

/**
 * Remove our PostToolUse hook from `.claude/settings.json` (dropping any group
 * left empty) and delete the copied hook script. Leaves every other setting and
 * hook untouched, and never recreates settings.json if it was absent.
 *
 * @param {string} workspaceDir
 * @returns {boolean} whether anything was removed
 */
function removeActivityHook(workspaceDir) {
  let changed = false;

  fs.removeSync(hookScriptPath(workspaceDir));
  const hooksDir = path.join(workspaceDir, '.amlog', 'hooks');
  if (fs.existsSync(hooksDir) && fs.readdirSync(hooksDir).length === 0) {
    fs.removeSync(hooksDir);
  }

  const p = settingsPath(workspaceDir);
  if (!fs.existsSync(p)) return changed;
  const settings = readSettings(workspaceDir);
  const groups = settings.hooks && Array.isArray(settings.hooks.PostToolUse)
    ? settings.hooks.PostToolUse : null;
  if (!groups) return changed;

  const next = groups
    .map((g) => (Array.isArray(g.hooks)
      ? { ...g, hooks: g.hooks.filter((h) => !isOurCommand(h)) }
      : g))
    .filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);

  if (next.length !== groups.length
      || next.some((g, i) => Array.isArray(g.hooks) && g.hooks.length !== groups[i].hooks.length)) {
    changed = true;
    if (next.length > 0) settings.hooks.PostToolUse = next;
    else delete settings.hooks.PostToolUse;
    if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
    fs.outputJsonSync(p, settings, { spaces: 2 });
  }
  return changed;
}

/**
 * Whether the activity hook is both registered and its script present (doctor).
 *
 * @param {string} workspaceDir
 */
function isActivityHookInstalled(workspaceDir) {
  return hasActivityHook(readSettings(workspaceDir)) && fs.existsSync(hookScriptPath(workspaceDir));
}

module.exports = {
  HOOK_MATCHER,
  HOOK_COMMAND,
  installActivityHook,
  removeActivityHook,
  isActivityHookInstalled,
  hasActivityHook,
  hookScriptPath,
  settingsPath,
};
