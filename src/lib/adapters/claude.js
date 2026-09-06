'use strict';

const path = require('path');
const fs = require('fs-extra');
const { stringifyFrontmatter } = require('../frontmatter');

const id = 'claude';
const label = 'Claude Code';

function dir(workspaceDir) {
  return path.join(workspaceDir, '.claude', 'agents');
}

function filePath(workspaceDir, fileBase) {
  return path.join(dir(workspaceDir), `${fileBase}.md`);
}

async function write(fileBase, meta, body, workspaceDir) {
  const frontmatter = {
    name: meta.name,
    description: meta.description,
    ...(meta.tools ? { tools: meta.tools } : {}),
  };
  const dest = filePath(workspaceDir, fileBase);
  await fs.outputFile(dest, stringifyFrontmatter(frontmatter, body), 'utf8');
  return dest;
}

async function remove(fileBase, workspaceDir) {
  await fs.remove(filePath(workspaceDir, fileBase));
}

function listInstalledNames(workspaceDir) {
  const d = dir(workspaceDir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
}

module.exports = { id, label, dir, write, remove, listInstalledNames };
