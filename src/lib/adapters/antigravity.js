'use strict';

const path = require('path');
const fs = require('fs-extra');
const { stringifyFrontmatter } = require('../frontmatter');

const id = 'antigravity';
const label = 'Antigravity';

// `agy` discovers project agents in `<workspace>/.agents/agents/<name>/AGENT.md`
// (verified with `agy --agent <name>`; a bare `agents/agents/` is ignored).
function dir(workspaceDir) {
  return path.join(workspaceDir, '.agents', 'agents');
}

function agentDir(workspaceDir, fileBase) {
  return path.join(dir(workspaceDir), fileBase);
}

function filePath(workspaceDir, fileBase) {
  return path.join(agentDir(workspaceDir, fileBase), 'AGENT.md');
}

// A previous release wrote to `agents/agents/<fileBase>/` (never discovered by
// agy). Remove that stale copy for this agent, then drop the folders if empty.
async function removeLegacy(workspaceDir, fileBase) {
  const root = path.join(workspaceDir, 'agents');
  await fs.remove(path.join(root, 'agents', fileBase));
  for (const d of [path.join(root, 'agents'), root]) {
    if (fs.existsSync(d) && fs.readdirSync(d).length === 0) await fs.remove(d);
  }
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

  await removeLegacy(workspaceDir, fileBase);

  const dest = filePath(workspaceDir, fileBase);
  await fs.outputFile(dest, stringifyFrontmatter(frontmatter, body), 'utf8');
  return dest;
}

async function remove(fileBase, workspaceDir) {
  await fs.remove(agentDir(workspaceDir, fileBase));
  await removeLegacy(workspaceDir, fileBase);
}

function listInstalledNames(workspaceDir) {
  const d = dir(workspaceDir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(d, e.name, 'AGENT.md')))
    .map((e) => e.name);
}

module.exports = { id, label, dir, filePath, write, remove, listInstalledNames };
