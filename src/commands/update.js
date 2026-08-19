'use strict';

const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { filterAgents } = require('../lib/manifest');
const { copyAgents, getInstalledTypes } = require('../lib/copy-agents');
const { updateAgentInstructionFile } = require('../lib/detect-agent-cli');

const WORKSPACE = process.cwd();

/**
 * `amlog update` — re-pulls latest agent definitions for already-installed roles.
 */
async function runUpdate(opts) {
  console.log(chalk.bold.cyan('\n🔄 amlog update\n'));

  const installedTypes = getInstalledTypes(WORKSPACE);
  if (installedTypes.length === 0) {
    console.log(chalk.yellow('  No agents installed in this workspace. Run `amlog install` first.'));
    return;
  }

  console.log(chalk.gray(`  Re-pulling agents for types: ${installedTypes.join(', ')}\n`));

  const agents = filterAgents(installedTypes);
  const spinner = ora('Updating agents...').start();
  const results = await copyAgents(agents, WORKSPACE);
  spinner.stop();

  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  ok.forEach(r => console.log(chalk.green(`  ✓ ${r.agent.type}/${r.agent.name}`)));
  failed.forEach(r => console.log(chalk.red(`  ✗ ${r.agent.type}/${r.agent.name}: ${r.error}`)));

  const instrFile = await updateAgentInstructionFile(WORKSPACE, ok.map(r => r.agent));
  console.log(chalk.gray(`\n  Agent list refreshed in: ${path.relative(WORKSPACE, instrFile)}`));

  console.log(chalk.bold.green(`\n✅ Update complete. ${ok.length} agent(s) refreshed.\n`));
}

module.exports = { runUpdate };
