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
 * Embeds each agent's full instructions inline so any AI CLI reading this file
 * automatically has the complete agent definitions — no manual @-references needed.
 *
 * If the file doesn't exist, create AGENTS.md.
 *
 * @param {string} workspaceDir
 * @param {object[]} installedAgents - [{name, type, stage, description, path}]
 */
async function updateAgentInstructionFile(workspaceDir, installedAgents) {
  let filePath = detectAgentInstructionFile(workspaceDir);
  if (!filePath) {
    filePath = path.join(workspaceDir, 'AGENTS.md');
  }

  const section = buildSection(workspaceDir, installedAgents);
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

  const START_MARKER = '<!-- amlog:start -->';
  const END_MARKER   = '<!-- amlog:end -->';

  if (content.includes(START_MARKER)) {
    const startIdx = content.indexOf(START_MARKER);
    const endIdx   = content.indexOf(END_MARKER) + END_MARKER.length;
    content = content.slice(0, startIdx) + section + content.slice(endIdx);
  } else {
    content = content.trimEnd() + '\n\n' + section + '\n';
  }

  await fs.outputFile(filePath, content, 'utf8');
  return filePath;
}

/**
 * Build the fenced markdown section.
 * Each installed agent's full agent.md content is embedded inline so any AI CLI
 * that reads AGENTS.md (Gemini/Antigravity, Claude, Cursor, etc.) automatically
 * has the complete instructions without needing explicit file references.
 *
 * @param {string} workspaceDir
 * @param {object[]} agents
 * @returns {string}
 */
function buildSection(workspaceDir, agents) {
  const lines = [
    '<!-- amlog:start -->',
    '# amlog — Installed Agents',
    '',
    '> Managed by `amlog`. Do not edit this section manually — run `amlog update` to refresh.',
    '',
    '## How to invoke an agent',
    '',
    'Tell your AI assistant to act as a specific agent by name, e.g.:',
    '- _"Act as `planner-amlog` and create a plan for story #42"_',
    '- _"Run `implementor-amlog` on the backend"_',
    '',
    'Or reference the agent file directly in your session:',
    '```',
    '@.amlog/agents/<type>/<name>/agent.md',
    '```',
    '',
    '---',
    '',
  ];

  // Group agents by type for readability
  const byType = {};
  for (const a of agents) {
    if (!byType[a.type]) byType[a.type] = [];
    byType[a.type].push(a);
  }

  for (const [type, list] of Object.entries(byType)) {
    lines.push(`## ${type} agents`);
    lines.push('');

    for (const agent of list) {
      const agentFilePath = path.join(
        workspaceDir,
        '.amlog', 'agents', agent.type, agent.name, 'agent.md'
      );

      lines.push(`### ${agent.name}`);
      lines.push('');

      if (fs.existsSync(agentFilePath)) {
        // Embed the full agent.md content so the AI has all instructions loaded
        const agentContent = fs.readFileSync(agentFilePath, 'utf8').trim();
        lines.push(agentContent);
      } else {
        // Fallback: path reference if file not found (shouldn't happen after install)
        lines.push(`> **File:** \`.amlog/agents/${agent.type}/${agent.name}/agent.md\``);
        lines.push(`> ${agent.description}`);
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  lines.push('<!-- amlog:end -->');
  return lines.join('\n');
}

module.exports = { detectAgentInstructionFile, updateAgentInstructionFile };

