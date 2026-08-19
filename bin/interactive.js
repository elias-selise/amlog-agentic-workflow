#!/usr/bin/env node
'use strict';

/**
 * Interactive installer — shown when `amlog` is run with no arguments.
 * Prompts the user for their role and runs the install command.
 */
const prompts = require('prompts');
const chalk = require('chalk');
const { runInstall } = require('../src/commands/install');

async function runInteractive() {
  console.log(chalk.bold.cyan('\n  🚀  amlog — Agentic SDLC Workflow\n'));
  console.log(chalk.gray('  This will install role-specific AI agents + CodeGraph knowledge base'));
  console.log(chalk.gray('  into your current workspace.\n'));

  const { role } = await prompts({
    type: 'select',
    name: 'role',
    message: 'Which role are you installing for?',
    choices: [
      { title: 'Frontend Developer', value: 'frontend' },
      { title: 'Backend Developer', value: 'backend' },
      { title: 'QA Engineer', value: 'qa' },
      { title: 'Business Analyst', value: 'ba' },
      { title: 'Everything (all roles)', value: 'all' },
    ],
    initial: 0,
  });

  if (!role) {
    console.log(chalk.yellow('\n  Cancelled.\n'));
    process.exit(0);
  }

  const opts = { [role]: true, yes: false };
  await runInstall(opts);
}

module.exports = { runInteractive };
