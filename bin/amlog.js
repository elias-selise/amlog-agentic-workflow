#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const { version } = require('../package.json');

program
  .name('amlog')
  .description('Agentic SDLC workflow toolkit — installs role-specific AI agents + CodeGraph knowledge base.')
  .version(version, '-v, --version', 'Print installed CLI version');

// amlog install
program
  .command('install')
  .description('Install agents + bootstrap knowledge base into the current workspace')
  .option('--frontend', 'Install frontend-dev + dev agents')
  .option('--backend', 'Install backend-dev + dev agents')
  .option('--qa', 'Install QA agents')
  .option('--ba', 'Install BA agents')
  .option('--all', 'Install all agents')
  .option('--target <types>', 'Comma-separated agent types (e.g. frontend-dev,qa)')
  .option('--yes', 'Skip interactive prompts')
  .option('--location <scope>', 'Where CLI config lives: global | local', 'global')
  .action(async (opts) => {
    const { runInstall } = require('../src/commands/install');
    await runInstall(opts);
  });

// amlog update
program
  .command('update')
  .description('Re-pull latest agent definitions for already-installed roles in this workspace')
  .option('--yes', 'Skip interactive prompts')
  .action(async (opts) => {
    const { runUpdate } = require('../src/commands/update');
    await runUpdate(opts);
  });

// amlog uninstall
program
  .command('uninstall')
  .description('Remove agents (and optionally the knowledge base) from this workspace')
  .option('--keep-knowledge-base', 'Keep .codegraph index, remove agents only')
  .option('--yes', 'Skip interactive prompts')
  .action(async (opts) => {
    const { runUninstall } = require('../src/commands/uninstall');
    await runUninstall(opts);
  });

// amlog upgrade
program
  .command('upgrade [version]')
  .description('Update the amlog CLI itself')
  .action(async (ver) => {
    const { runUpgrade } = require('../src/commands/upgrade');
    await runUpgrade(ver);
  });

// amlog list
program
  .command('list')
  .description('Show every agent in the registry, with type/stage')
  .action(async () => {
    const { runList } = require('../src/commands/list');
    await runList();
  });

// amlog status
program
  .command('status')
  .description('Show installed agents in this workspace + CodeGraph index status')
  .action(async () => {
    const { runStatus } = require('../src/commands/status');
    await runStatus();
  });

// Default: interactive installer when no subcommand given
if (process.argv.length <= 2) {
  (async () => {
    const { runInteractive } = require('./interactive');
    await runInteractive();
  })();
} else {
  program.parse(process.argv);
}
