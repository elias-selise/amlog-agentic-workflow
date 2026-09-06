'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const prompts = require('prompts');
const { uninstallAgents, getInstalledAgents } = require('../lib/copy-agents');

const WORKSPACE = process.cwd();
const AMLOG_DIR      = path.join(WORKSPACE, '.amlog');
const CODEGRAPH_DIR  = path.join(WORKSPACE, '.codegraph');
const KNOWLEDGE_DIR  = path.join(WORKSPACE, '.knowledge-graph');

/**
 * `amlog uninstall` — removes agents (from their native tool locations) and
 * optionally the knowledge base.
 */
async function runUninstall(opts) {
  console.log(chalk.bold.cyan('\n🗑  amlog uninstall\n'));

  const installed = getInstalledAgents(WORKSPACE);
  if (installed.length === 0) {
    console.log(chalk.yellow('  No agents installed in this workspace (per .amlog/state.json) — nothing to remove.'));
    return;
  }

  if (!opts.yes) {
    const keepKb = opts.keepKnowledgeBase;
    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: keepKb
        ? `Remove ${installed.length} installed agent(s) (keep knowledge base)?`
        : `Remove ${installed.length} installed agent(s) AND knowledge base dirs?`,
      initial: false,
    });
    if (!ok) { console.log(chalk.yellow('Cancelled.')); process.exit(0); }
  }

  const removed = await uninstallAgents(WORKSPACE);
  removed.forEach(r => console.log(chalk.green(`  ✓ Removed [${r.tool}] ${r.type}/${r.name}`)));

  if (fs.existsSync(AMLOG_DIR)) {
    await fs.remove(AMLOG_DIR);
    console.log(chalk.green('  ✓ Removed .amlog/ (scripts + state)'));
  }

  if (!opts.keepKnowledgeBase) {
    for (const dir of [CODEGRAPH_DIR, KNOWLEDGE_DIR]) {
      if (fs.existsSync(dir)) {
        await fs.remove(dir);
        console.log(chalk.green(`  ✓ Removed ${path.basename(dir)}/`));
      }
    }
  } else {
    console.log(chalk.gray('  Knowledge base directories preserved (--keep-knowledge-base).'));
  }

  console.log(chalk.bold.green('\n✅ Uninstall complete.\n'));
}

module.exports = { runUninstall };
