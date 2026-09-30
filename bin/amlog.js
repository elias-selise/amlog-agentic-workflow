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
  .option('--frontend', 'Install fe + dev agents')
  .option('--backend', 'Install be + dev agents')
  .option('--qa', 'Install QA agents')
  .option('--ba', 'Install BA agents')
  .option('--all', 'Install all agents')
  .option('--target <types>', 'Comma-separated agent types (e.g. fe,qa)')
  .option('--claude', 'Install native Claude Code subagents (.claude/agents/)')
  .option('--antigravity', 'Install native Antigravity subagents (agents/agents/<name>/AGENT.md)')
  .option('--codex', 'Install native Codex subagents (.codex/agents/)')
  .option('--opencode', 'Install native OpenCode subagents (.opencode/agent/)')
  .option('--tools <ids>', 'Comma-separated tool ids (e.g. claude,codex)')
  .option('--yes', 'Skip interactive prompts')
  .option('--location <scope>', 'Where CLI config lives: global | local', 'global')
  .option('--auto-handover', 'Let agents hand off to each other without asking (writes auto_handover: true)')
  .option('--no-auto-handover', 'Ask before every agent-to-agent handoff (writes auto_handover: false)')
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

// amlog doctor
program
  .command('doctor')
  .description('Diagnose the local environment: Node version, CodeGraph resolution, workspace setup')
  .action(async () => {
    const { runDoctor } = require('../src/commands/doctor');
    await runDoctor();
  });

// amlog handoff — loop guard agents call before handing work to another agent
program
  .command('handoff <action>')
  .description('Agent handoff loop guard: check | record | reset | status (reads auto_handover from amlog-workflow.config.json)')
  .option('--issue <key>', 'Issue number (or story name before an issue exists)')
  .option('--from <agent>', 'Handing-off agent, as <name>/<type> (e.g. implementor-amlog/be)')
  .option('--to <agent>', 'Receiving agent, as <name>/<type> (e.g. test-runner-amlog/be)')
  .option('--reason <text>', 'Why this handoff is happening (record/reset)')
  .option('--human-approved', 'record: a human approved continuing past the loop limit — restarts the count for this pair')
  .action(async (action, opts) => {
    const { runHandoff } = require('../src/commands/handoff');
    await runHandoff(action, opts);
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
