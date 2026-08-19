'use strict';

const path = require('path');
const fs = require('fs-extra');

/**
 * Detect which agent instruction file exists in the workspace.
 * Priority: AGENTS.md > CLAUDE.md > GEMINI.md > CURSOR.md
 *
 * @param {string} workspaceDir
 * @returns {string|null} absolute path to the detected file, or null
 */
function detectAgentInstructionFile(workspaceDir) {
  const candidates = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CURSOR.md'];
  for (const name of candidates) {
    const p = path.join(workspaceDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Write or refresh the amlog-managed fenced section inside the instruction file.
 * If the file doesn't exist, create AGENTS.md.
 *
 * @param {string} workspaceDir
 * @param {object[]} installedAgents - [{name, type, stage, description}]
 */
async function updateAgentInstructionFile(workspaceDir, installedAgents) {
  let filePath = detectAgentInstructionFile(workspaceDir);
  if (!filePath) {
    filePath = path.join(workspaceDir, 'AGENTS.md');
  }

  const section = buildSection(installedAgents);
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

  const START_MARKER = '<!-- amlog:start -->';
  const END_MARKER   = '<!-- amlog:end -->';

  if (content.includes(START_MARKER)) {
    // Replace existing section
    const startIdx = content.indexOf(START_MARKER);
    const endIdx   = content.indexOf(END_MARKER) + END_MARKER.length;
    content = content.slice(0, startIdx) + section + content.slice(endIdx);
  } else {
    // Append section
    content = content.trimEnd() + '\n\n' + section + '\n';
  }

  await fs.outputFile(filePath, content, 'utf8');
  return filePath;
}

/**
 * Build the fenced markdown section listing installed agents.
 */
function buildSection(agents) {
  const lines = [
    '<!-- amlog:start -->',
    '## amlog — Installed Agents',
    '',
    '> This section is managed by `amlog`. Do not edit manually.',
    '',
    '| Agent | Type | Stage | Description |',
    '|-------|------|-------|-------------|',
  ];

  for (const a of agents) {
    lines.push(`| \`${a.name}\` | \`${a.type}\` | ${a.stage} | ${a.description} |`);
  }

  lines.push('');
  lines.push('**Usage:** Each agent lives under `.amlog/agents/<type>/<name>/agent.md`.');
  lines.push('Reference it in your agent CLI session by pointing at that path.');
  lines.push('<!-- amlog:end -->');

  return lines.join('\n');
}

module.exports = { detectAgentInstructionFile, updateAgentInstructionFile };
