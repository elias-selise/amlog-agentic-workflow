'use strict';

const path = require('path');
const chalk = require('chalk');
const { getInstalledAgents } = require('../lib/copy-agents');
const { isCodegraphInstalled, readZones, printZoneStatus } = require('../lib/knowledge-base');

const WORKSPACE = process.cwd();

/**
 * `amlog status` — show installed agents + CodeGraph index status.
 */
async function runStatus() {
  console.log(chalk.bold.cyan('\n📊 amlog status\n'));

  // Installed agents
  const installed = getInstalledAgents(WORKSPACE);
  if (installed.length === 0) {
    console.log(chalk.yellow('  No agents installed in this workspace.'));
    console.log(chalk.gray('  Run `amlog install` to get started.\n'));
  } else {
    console.log(chalk.bold('  Installed agents:\n'));
    // Group by type
    const byType = {};
    for (const a of installed) {
      if (!byType[a.type]) byType[a.type] = [];
      byType[a.type].push(a.name);
    }
    for (const [type, names] of Object.entries(byType)) {
      console.log(chalk.bold(`  ${type}`));
      names.forEach(n => console.log(chalk.green(`    ✓ ${n}`)));
    }
    console.log();
  }

  // CodeGraph status
  console.log(chalk.bold('  CodeGraph:\n'));
  if (!isCodegraphInstalled()) {
    console.log(chalk.yellow('  ✗ CodeGraph not installed.'));
    console.log(chalk.gray('  Run `amlog install` to install it.\n'));
    return;
  }
  console.log(chalk.green('  ✓ CodeGraph installed\n'));

  const zones = readZones(WORKSPACE);
  printZoneStatus(zones, WORKSPACE);
  console.log();
}

module.exports = { runStatus };
