'use strict';

const path = require('path');
const fs = require('fs-extra');
const { getAdapter } = require('./adapters');
const { loadManifest } = require('./manifest');
const { stripAmlogSection } = require('./detect-agent-cli');

// Distinct from the legacy `<!-- amlog:start -->` markers, which the migration
// step strips as "old install" — this section is current, not legacy.
const ROUTER_START = '<!-- amlog:router:start -->';
const ROUTER_END = '<!-- amlog:router:end -->';
const TEMPLATE_PATH = path.join(__dirname, '../../registry/router/ROUTER.md');

// The always-loaded instruction file each tool reads at session start. That's
// where routing has to live: the main session picks the agent, so the rules
// can't sit inside an agent definition.
const TOOL_INSTRUCTION_FILE = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  opencode: 'AGENTS.md',
  antigravity: 'AGENTS.md',
};

const ROUTER_FILES = [...new Set(Object.values(TOOL_INSTRUCTION_FILE))];

// `@AGENTS.md` / `@./AGENTS.md` import in CLAUDE.md — Claude Code already sees
// AGENTS.md's routing section then, so writing a second copy is just noise.
const IMPORTS_AGENTS_MD = /(^|\s)@(\.\/)?AGENTS\.md\b/m;

function escapeCell(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Group installed tools by the instruction file their routing section goes in.
 *
 * @param {string} workspaceDir
 * @param {string[]} tools
 * @returns {Map<string, string[]>} file name → tool ids
 */
function planRouterFiles(workspaceDir, tools) {
  const byFile = new Map();
  for (const tool of tools) {
    const file = TOOL_INSTRUCTION_FILE[tool];
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(tool);
  }

  const claudeMd = path.join(workspaceDir, 'CLAUDE.md');
  if (byFile.has('CLAUDE.md') && byFile.has('AGENTS.md') && fs.existsSync(claudeMd)
      && IMPORTS_AGENTS_MD.test(fs.readFileSync(claudeMd, 'utf8'))) {
    byFile.get('AGENTS.md').push(...byFile.get('CLAUDE.md'));
    byFile.delete('CLAUDE.md');
  }
  return byFile;
}

/**
 * Render the routing section for the agents installed for `tools`.
 *
 * @param {string} workspaceDir
 * @param {object[]} installs - state.json install records
 * @param {string[]} tools    - tool ids served by this instruction file
 * @returns {string}
 */
function buildRouterSection(workspaceDir, installs, tools) {
  const { agents } = loadManifest();
  const installed = new Map();
  for (const rec of installs) {
    if (tools.includes(rec.tool)) installed.set(`${rec.name}::${rec.type}`, rec.fileBase);
  }

  // Manifest order is pipeline order, which keeps the table easy to scan.
  const rows = agents
    .filter((a) => installed.has(`${a.name}::${a.type}`))
    .map((a) => `| ${escapeCell(a.triggers || a.description)} | \`${installed.get(`${a.name}::${a.type}`)}\` | ${a.type} |`);

  const table = ['| When the user wants to… | Agent id | Role |', '|---|---|---|', ...rows].join('\n');

  const defLines = tools.map((tool) => {
    const adapter = getAdapter(tool);
    const rel = path.relative(workspaceDir, adapter.filePath(workspaceDir, '<agent-id>')).split(path.sep).join('/');
    return `- ${adapter.label}: \`${rel}\``;
  });
  const definitions = ['Agent definition files (the fallback in rule 6):', ...defLines].join('\n');

  const body = fs.readFileSync(TEMPLATE_PATH, 'utf8')
    .replace('{{ROUTING_TABLE}}', table)
    .replace('{{DEFINITION_FILES}}', definitions)
    .trimEnd();

  return `${ROUTER_START}\n${body}\n${ROUTER_END}`;
}

/**
 * Insert or replace the routing section in one file, creating the file if
 * it doesn't exist. Everything outside the markers is left as-is.
 */
function upsertSection(filePath, section) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const startIdx = existing.indexOf(ROUTER_START);
  let next;
  if (startIdx !== -1) {
    const endIdx = existing.indexOf(ROUTER_END, startIdx);
    const sliceEnd = endIdx === -1 ? existing.length : endIdx + ROUTER_END.length;
    next = existing.slice(0, startIdx) + section + existing.slice(sliceEnd);
  } else if (existing.trim().length === 0) {
    next = `${section}\n`;
  } else {
    next = `${existing.trimEnd()}\n\n${section}\n`;
  }
  if (next !== existing) fs.outputFileSync(filePath, next, 'utf8');
}

/**
 * Write the routing section into the instruction file of every tool that has
 * agents installed, and remove it from instruction files no installed tool
 * reads anymore.
 *
 * @param {string} workspaceDir
 * @param {object[]} installs - state.json install records
 * @returns {string[]} instruction file names written
 */
function syncRouterSections(workspaceDir, installs) {
  const tools = [...new Set(installs.map((r) => r.tool))];
  const plan = planRouterFiles(workspaceDir, tools);

  for (const [file, fileTools] of plan) {
    upsertSection(path.join(workspaceDir, file), buildRouterSection(workspaceDir, installs, fileTools));
  }
  for (const file of ROUTER_FILES) {
    if (!plan.has(file)) stripAmlogSection(path.join(workspaceDir, file), ROUTER_START, ROUTER_END);
  }
  return [...plan.keys()];
}

/**
 * Strip the routing section from every instruction file (used by uninstall).
 *
 * @param {string} workspaceDir
 * @returns {string[]} instruction file names cleaned
 */
function removeRouterSections(workspaceDir) {
  return ROUTER_FILES.filter((file) => stripAmlogSection(path.join(workspaceDir, file), ROUTER_START, ROUTER_END));
}

/**
 * Instruction files that currently carry a routing section (used by doctor).
 *
 * @param {string} workspaceDir
 * @returns {string[]}
 */
function findRouterSections(workspaceDir) {
  return ROUTER_FILES.filter((file) => {
    const p = path.join(workspaceDir, file);
    return fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes(ROUTER_START);
  });
}

module.exports = {
  ROUTER_START,
  ROUTER_END,
  TOOL_INSTRUCTION_FILE,
  buildRouterSection,
  syncRouterSections,
  removeRouterSections,
  findRouterSections,
};
