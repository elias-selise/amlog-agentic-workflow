'use strict';

const chalk = require('chalk');
const { loadManifest } = require('../lib/manifest');

/**
 * `amlog list` — show every agent in the registry with type/stage.
 */
async function runList() {
  console.log(chalk.bold.cyan('\n📋 amlog list — Agent Registry\n'));

  const manifest = loadManifest();
  const agents = manifest.agents;

  if (!agents || agents.length === 0) {
    console.log(chalk.yellow('  No agents in registry.'));
    return;
  }

  // Group by type
  const byType = {};
  for (const a of agents) {
    if (!byType[a.type]) byType[a.type] = [];
    byType[a.type].push(a);
  }

  for (const [type, list] of Object.entries(byType)) {
    console.log(chalk.bold(`  ${type}`));
    for (const a of list) {
      console.log(
        chalk.green(`    ${a.name.padEnd(30)}`) +
        chalk.gray(`[${a.stage}]`) +
        `  ${a.description}`
      );
    }
    console.log();
  }

  console.log(chalk.gray(`  Total: ${agents.length} agent(s)\n`));
}

module.exports = { runList };
