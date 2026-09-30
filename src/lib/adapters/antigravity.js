'use strict';

const path = require('path');
const fs = require('fs-extra');
const { stringifyFrontmatter } = require('../frontmatter');

const id = 'antigravity';
const label = 'Antigravity';

function dir(workspaceDir) {
  return path.join(workspaceDir, 'agents', 'agents');
}

function agentDir(workspaceDir, fileBase) {
  return path.join(dir(workspaceDir), fileBase);
}

function filePath(workspaceDir, fileBase) {
  return path.join(agentDir(workspaceDir, fileBase), 'AGENT.md');
}

// Pre-fix installs wrote a flat `.agents/agents/<fileBase>.md` file. Clean up
// that stale file for this agent so re-installing/updating self-heals it.
function legacyFlatFilePath(workspaceDir, fileBase) {
  return path.join(workspaceDir, '.agents', 'agents', `${fileBase}.md`);
}

async function write(fileBase, meta, body, workspaceDir) {
  const frontmatter = {
    name: fileBase,
    description: meta.description,
    ...(meta.tools ? { tools: meta.tools } : {}),
    ...(meta.skills ? { skills: meta.skills } : {}),
    mainAgent: false,
    subagent: true,
  };

  const legacyFlatFile = legacyFlatFilePath(workspaceDir, fileBase);
  if (fs.existsSync(legacyFlatFile)) await fs.remove(legacyFlatFile);

  const dest = filePath(workspaceDir, fileBase);
  await fs.outputFile(dest, stringifyFrontmatter(frontmatter, body), 'utf8');
  return dest;
}

async function remove(fileBase, workspaceDir) {
  await fs.remove(agentDir(workspaceDir, fileBase));
}

function listInstalledNames(workspaceDir) {
  const d = dir(workspaceDir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(d, e.name, 'AGENT.md')))
    .map((e) => e.name);
}

module.exports = { id, label, dir, filePath, write, remove, listInstalledNames };
