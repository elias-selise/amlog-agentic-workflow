'use strict';

const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const prompts = require('prompts');
const { resolveTargetTypes, filterAgents } = require('../lib/manifest');
const { copyAgents } = require('../lib/copy-agents');
const { updateAgentInstructionFile } = require('../lib/detect-agent-cli');
const { bootstrapKnowledgeBase } = require('../lib/knowledge-base');

const WORKSPACE = process.cwd();

/**
 * `amlog install` command.
 *
 * @param {object} opts - CLI options
 */
async function runInstall(opts) {
  console.log(chalk.bold.cyan('\n🔧 amlog install\n'));

  // If no role flags were provided, prompt interactively
  const hasRole = opts.frontend || opts.backend || opts.qa || opts.ba || opts.all || opts.target;
  if (!hasRole) {
    const { role } = await prompts({
      type: 'select',
      name: 'role',
      message: 'Which role do you want to install?',
      choices: [
        { title: 'Frontend Developer', value: 'frontend' },
        { title: 'Backend Developer', value: 'backend' },
        { title: 'QA Engineer',       value: 'qa' },
        { title: 'Business Analyst',  value: 'ba' },
        { title: 'Everything',        value: 'all' },
      ],
    });
    if (!role) { console.log(chalk.yellow('Cancelled.')); process.exit(0); }
    opts[role] = true;
  }

  // 1. Resolve target types
  const targetTypes = resolveTargetTypes(opts);
  console.log(chalk.gray(`  Target types: ${targetTypes.join(', ')}\n`));

  // 2. Filter agents from manifest
  const agents = filterAgents(targetTypes);
  if (agents.length === 0) {
    console.log(chalk.yellow('  No agents matched the specified types. Check amlog list.'));
    return;
  }

  // 3. Confirm unless --yes
  if (!opts.yes) {
    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: `Install ${agents.length} agent(s) into ${WORKSPACE}?`,
      initial: true,
    });
    if (!ok) { console.log(chalk.yellow('Cancelled.')); process.exit(0); }
  }

  // 4. Copy agents
  const spinner = ora('Copying agents...').start();
  const results = await copyAgents(agents, WORKSPACE);
  spinner.stop();

  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  ok.forEach(r => console.log(chalk.green(`  ✓ ${r.agent.type}/${r.agent.name}`)));
  failed.forEach(r => console.log(chalk.red(`  ✗ ${r.agent.type}/${r.agent.name}: ${r.error}`)));

  // 5. Update agent instruction file
  const agentDetails = ok.map(r => r.agent);
  const instrFile = await updateAgentInstructionFile(WORKSPACE, agentDetails);
  console.log(chalk.gray(`\n  Agent list written to: ${path.relative(WORKSPACE, instrFile)}`));

  // 6. Bootstrap knowledge base
  await bootstrapKnowledgeBase(WORKSPACE);

  // 7. Summary
  console.log(chalk.bold.green(`\n✅ Done! ${ok.length} agent(s) installed.\n`));
  if (failed.length > 0) {
    console.log(chalk.yellow(`  ⚠  ${failed.length} agent(s) failed to copy — check errors above.\n`));
  }
}

module.exports = { runInstall };
