'use strict';

const chalk = require('chalk');
const ora = require('ora');
const prompts = require('prompts');
const { resolveTargetTypes, resolveTargetTools, filterAgents, loadManifest } = require('../lib/manifest');
const { installAgents } = require('../lib/copy-agents');
const { TOOL_IDS, getAdapter } = require('../lib/adapters');
const { bootstrapKnowledgeBase } = require('../lib/knowledge-base');
const { ensureGitignoreEntries } = require('../lib/gitignore');
const { runMigration } = require('../lib/migrate');

const WORKSPACE = process.cwd();

const TOOL_CHOICES = TOOL_IDS.map((id) => ({ title: getAdapter(id).label, value: id }));

/**
 * `amlog install` command.
 *
 * @param {object} opts - CLI options
 */
async function runInstall(opts) {
  console.log(chalk.bold.cyan('\n🔧 amlog install\n'));

  await runMigration(WORKSPACE, { yes: opts.yes });

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

  // If no tool flags were provided, prompt interactively (multi-select)
  const hasTool = TOOL_IDS.some((id) => opts[id]) || opts.tools;
  if (!hasTool) {
    const { tools } = await prompts({
      type: 'multiselect',
      name: 'tools',
      message: 'Which AI tool(s) do you want to install agents for?',
      choices: TOOL_CHOICES,
      min: 1,
    });
    if (!tools || tools.length === 0) { console.log(chalk.yellow('Cancelled.')); process.exit(0); }
    for (const t of tools) opts[t] = true;
  }

  // 1. Resolve target types + tools
  const targetTypes = resolveTargetTypes(opts);
  const targetTools = resolveTargetTools(opts);
  console.log(chalk.gray(`  Target types: ${targetTypes.join(', ')}`));
  console.log(chalk.gray(`  Target tools: ${targetTools.map((t) => getAdapter(t).label).join(', ')}\n`));

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
      message: `Install ${agents.length} agent(s) for ${targetTools.length} tool(s) into ${WORKSPACE}?`,
      initial: true,
    });
    if (!ok) { console.log(chalk.yellow('Cancelled.')); process.exit(0); }
  }

  // 4. Install agents (converted per-tool, natively)
  const { agents: allAgents } = loadManifest();
  const spinner = ora('Installing agents...').start();
  const results = await installAgents(agents, targetTools, WORKSPACE, allAgents);
  spinner.stop();

  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  ok.forEach(r => console.log(chalk.green(`  ✓ [${r.tool}] ${r.agent.type}/${r.agent.name}`)));
  failed.forEach(r => console.log(chalk.red(`  ✗ [${r.tool}] ${r.agent.type}/${r.agent.name}: ${r.error}`)));

  // 5. Ensure amlog/CodeGraph artifacts are gitignored
  ensureGitignoreEntries(WORKSPACE);

  // 6. Bootstrap knowledge base
  await bootstrapKnowledgeBase(WORKSPACE);

  // 7. Summary
  console.log(chalk.bold.green(`\n✅ Done! ${ok.length} agent install(s) completed.\n`));
  if (failed.length > 0) {
    console.log(chalk.yellow(`  ⚠  ${failed.length} agent install(s) failed — check errors above.\n`));
  }
}

module.exports = { runInstall };
