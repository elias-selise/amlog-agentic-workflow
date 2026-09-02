'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

// Directories amlog and CodeGraph generate at the workspace root — these are
// local/machine-specific artifacts and should never be committed.
const MANAGED_ENTRIES = ['.amlog/', '.codegraph/', '.knowledge-graph/'];

/**
 * Ensure the given entries exist in the workspace's .gitignore, appending any
 * that are missing. Creates .gitignore if it doesn't exist. Matching ignores
 * a trailing slash and leading/trailing whitespace so '.amlog' or '/.amlog/'
 * already covering the entry isn't duplicated.
 *
 * @param {string} workspaceDir
 * @param {string[]} entries
 */
function ensureGitignoreEntries(workspaceDir, entries = MANAGED_ENTRIES) {
  const gitignorePath = path.join(workspaceDir, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';

  const normalize = (line) => line.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  const existingLines = new Set(
    existing.split(/\r?\n/).map(normalize).filter(Boolean)
  );

  const missing = entries.filter((entry) => !existingLines.has(normalize(entry)));
  if (missing.length === 0) return;

  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const block = `${prefix}${existing.length === 0 ? '' : '\n'}# amlog / CodeGraph local artifacts\n${missing.join('\n')}\n`;

  fs.outputFileSync(gitignorePath, existing + block);
  console.log(chalk.green(`  ✓ Added ${missing.join(', ')} to .gitignore`));
}

module.exports = { ensureGitignoreEntries, MANAGED_ENTRIES };
