'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const prompts = require('prompts');

const WORKSPACE = process.cwd();
const AMLOG_DIR      = path.join(WORKSPACE, '.amlog');
const CODEGRAPH_DIR  = path.join(WORKSPACE, '.codegraph');
const KNOWLEDGE_DIR  = path.join(WORKSPACE, '.knowledge-graph');

/**
 * `amlog uninstall` — removes agents and optionally the knowledge base.
 */
async function runUninstall(opts) {
  console.log(chalk.bold.cyan('\n🗑  amlog uninstall\n'));

  if (!fs.existsSync(AMLOG_DIR)) {
    console.log(chalk.yellow('  .amlog/ not found in this workspace — nothing to remove.'));
    return;
  }

  if (!opts.yes) {
    const keepKb = opts.keepKnowledgeBase;
    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: keepKb
        ? 'Remove .amlog/ agents (keep knowledge base)?'
        : 'Remove .amlog/ agents AND knowledge base dirs?',
      initial: false,
    });
    if (!ok) { console.log(chalk.yellow('Cancelled.')); process.exit(0); }
  }

  // Remove .amlog/
  await fs.remove(AMLOG_DIR);
  console.log(chalk.green('  ✓ Removed .amlog/'));

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
