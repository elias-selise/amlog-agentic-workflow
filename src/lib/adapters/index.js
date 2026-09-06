'use strict';

const claude = require('./claude');
const codex = require('./codex');
const opencode = require('./opencode');
const antigravity = require('./antigravity');

const ADAPTERS = { claude, codex, opencode, antigravity };
const TOOL_IDS = Object.keys(ADAPTERS);

function getAdapter(toolId) {
  const adapter = ADAPTERS[toolId];
  if (!adapter) throw new Error(`Unknown tool: ${toolId}. Expected one of: ${TOOL_IDS.join(', ')}`);
  return adapter;
}

module.exports = { ADAPTERS, TOOL_IDS, getAdapter };
