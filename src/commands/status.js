'use strict';

const chalk = require('chalk');
const { getInstalledAgents } = require('../lib/copy-agents');
const { getAdapter } = require('../lib/adapters');
const { isCodegraphInstalled, readZones, printZoneStatus } = require('../lib/knowledge-base');

const WORKSPACE = process.cwd();

/**
 * `amlog status` — show installed agents (grouped by tool + role) + CodeGraph index status.
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
    const byTool = {};
    for (const a of installed) {
      if (!byTool[a.tool]) byTool[a.tool] = [];
      byTool[a.tool].push(a);
    }
    for (const [tool, agents] of Object.entries(byTool)) {
      const label = (() => { try { return getAdapter(tool).label; } catch { return tool; } })();
      console.log(chalk.bold(`  ${label}`));
      const byType = {};
      for (const a of agents) {
        if (!byType[a.type]) byType[a.type] = [];
        byType[a.type].push(a.name);
      }
      for (const [type, names] of Object.entries(byType)) {
        console.log(chalk.gray(`    ${type}`));
        names.forEach(n => console.log(chalk.green(`      ✓ ${n}`)));
      }
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
