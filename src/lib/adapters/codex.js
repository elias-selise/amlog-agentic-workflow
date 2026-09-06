'use strict';

const path = require('path');
const fs = require('fs-extra');

const id = 'codex';
const label = 'Codex';

function dir(workspaceDir) {
  return path.join(workspaceDir, '.codex', 'agents');
}

function filePath(workspaceDir, fileBase) {
  return path.join(dir(workspaceDir), `${fileBase}.toml`);
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// TOML literal multi-line strings (''' ... ''') take content verbatim — no
// escaping needed except guarding against the body itself containing the
// ''' delimiter sequence.
function tomlMultilineLiteral(value) {
  const safe = String(value).replace(/'''/g, "'' '");
  return `'''\n${safe}\n'''`;
}

async function write(fileBase, meta, body, workspaceDir) {
  const lines = [
    `name = ${tomlString(meta.name)}`,
    `description = ${tomlString(meta.description)}`,
    `developer_instructions = ${tomlMultilineLiteral(body.trimEnd())}`,
    '',
  ];
  const dest = filePath(workspaceDir, fileBase);
  await fs.outputFile(dest, lines.join('\n'), 'utf8');
  return dest;
}

async function remove(fileBase, workspaceDir) {
  await fs.remove(filePath(workspaceDir, fileBase));
}

function listInstalledNames(workspaceDir) {
  const d = dir(workspaceDir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((f) => f.endsWith('.toml'))
    .map((f) => f.slice(0, -5));
}

module.exports = { id, label, dir, write, remove, listInstalledNames };
