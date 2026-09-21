'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const prompts = require('prompts');
const { stripAmlogSection } = require('./detect-agent-cli');

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CURSOR.md'];

/**
 * Detect whether this workspace has a pre-native-tool amlog install: the old
 * `.amlog/agents/<type>/<name>/` tree, and/or an amlog-managed section in one
 * of the instruction files. Also detects the old flat Antigravity layout
 * (`.agents/agents/<name>.md`), superseded by `agents/agents/<name>/AGENT.md`.
 *
 * @param {string} workspaceDir
 * @returns {{ legacyAgentsDir: string|null, legacyAntigravityDir: string|null, instructionFiles: string[] }}
 */
function detectLegacyInstall(workspaceDir) {
  const legacyDir = path.join(workspaceDir, '.amlog', 'agents');
  const legacyAgentsDir = fs.existsSync(legacyDir) ? legacyDir : null;

  const legacyAntigravity = path.join(workspaceDir, '.agents', 'agents');
  const legacyAntigravityDir = fs.existsSync(legacyAntigravity) ? legacyAntigravity : null;

  const instructionFiles = INSTRUCTION_FILES
    .map((name) => path.join(workspaceDir, name))
    .filter((p) => fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('<!-- amlog:start -->'));

  return { legacyAgentsDir, legacyAntigravityDir, instructionFiles };
}

/**
 * Remove the legacy `.amlog/agents/` tree and strip any amlog-managed
 * section from the workspace's instruction file(s). No-op if nothing legacy
 * is found. Prompts for confirmation unless `opts.yes`.
 *
 * @param {string} workspaceDir
 * @param {{ yes?: boolean }} opts
 */
async function runMigration(workspaceDir, opts = {}) {
  const { legacyAgentsDir, legacyAntigravityDir, instructionFiles } = detectLegacyInstall(workspaceDir);
  if (!legacyAgentsDir && !legacyAntigravityDir && instructionFiles.length === 0) return;

  console.log(chalk.bold.cyan('\n🧹 Migrating legacy amlog install\n'));
  console.log(chalk.gray('  Agents used to live under .amlog/agents/ — they now install directly'));
  console.log(chalk.gray('  into each AI tool\'s native folder. This will remove:\n'));
  if (legacyAgentsDir) console.log(chalk.gray('    - .amlog/agents/ (old agent definitions)'));
  if (legacyAntigravityDir) console.log(chalk.gray('    - .agents/agents/ (old flat Antigravity layout, superseded by agents/agents/<name>/AGENT.md)'));
  for (const f of instructionFiles) {
    console.log(chalk.gray(`    - the amlog-managed section in ${path.relative(workspaceDir, f)}`));
  }

  if (!opts.yes) {
    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: 'Proceed with migration?',
      initial: true,
    });
    if (!ok) {
      console.log(chalk.yellow('\n  Migration skipped — re-run when ready.\n'));
      return;
    }
  }

  if (legacyAgentsDir) {
    await fs.remove(legacyAgentsDir);
    console.log(chalk.green('  ✓ Removed .amlog/agents/'));
  }
  if (legacyAntigravityDir) {
    await fs.remove(legacyAntigravityDir);
    console.log(chalk.green('  ✓ Removed .agents/agents/ (old flat Antigravity layout)'));
  }
  for (const f of instructionFiles) {
    stripAmlogSection(f);
    console.log(chalk.green(`  ✓ Cleaned ${path.relative(workspaceDir, f)}`));
  }
  console.log();
}

module.exports = { detectLegacyInstall, runMigration };
