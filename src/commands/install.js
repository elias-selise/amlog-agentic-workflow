'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const prompts = require('prompts');
const { resolveTargetTypes, resolveTargetTools, filterAgents, loadManifest, getKnownTypes } = require('../lib/manifest');
const { installAgents } = require('../lib/copy-agents');
const { TOOL_IDS, getAdapter } = require('../lib/adapters');
const { bootstrapKnowledgeBase, detectPlausibleZones } = require('../lib/knowledge-base');
const { ensureGitignoreEntries } = require('../lib/gitignore');
const { runMigration } = require('../lib/migrate');
const { canPrompt } = require('../lib/prompt-utils');

const CONFIG_FILE = 'amlog-workflow.config.json';

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
  let agents = filterAgents(targetTypes);
  if (agents.length === 0) {
    if (canPrompt(opts)) {
      console.log(chalk.yellow(`  No agents matched: ${targetTypes.join(', ')}`));
      const { types } = await prompts({
        type: 'multiselect',
        name: 'types',
        message: 'Pick valid agent type(s) instead:',
        choices: getKnownTypes().map((t) => ({ title: t, value: t })),
        min: 1,
      });
      if (!types || types.length === 0) { console.log(chalk.yellow('Cancelled.')); process.exit(0); }
      agents = filterAgents(types);
    }
    if (agents.length === 0) {
      console.log(chalk.yellow('  No agents matched the specified types. Check amlog list.'));
      return;
    }
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

  // 5b. Offer to configure multi-zone CodeGraph indexing if this looks like a
  // multi-project repo and no config exists yet
  const configPath = path.join(WORKSPACE, CONFIG_FILE);
  if (!fs.existsSync(configPath) && canPrompt(opts)) {
    const candidates = detectPlausibleZones(WORKSPACE);
    if (candidates.length >= 2) {
      const { zones } = await prompts({
        type: 'multiselect',
        name: 'zones',
        message: 'This looks like a multi-zone repo — index these as separate CodeGraph zones?',
        choices: candidates.map((c) => ({ title: c, value: c })),
      });
      if (zones && zones.length > 0) {
        const zoneMap = {};
        for (const z of zones) zoneMap[z] = z;
        fs.writeJsonSync(configPath, { zones: zoneMap }, { spaces: 2 });
        console.log(chalk.green(`  ✓ Wrote ${CONFIG_FILE}`));
      }
    }
  }

  // 6. Bootstrap knowledge base
  await bootstrapKnowledgeBase(WORKSPACE, targetTools, opts);

  // 7. Summary
  console.log(chalk.bold.green(`\n✅ Done! ${ok.length} agent install(s) completed.\n`));
  if (failed.length > 0) {
    console.log(chalk.yellow(`  ⚠  ${failed.length} agent install(s) failed — check errors above.\n`));
  }
}

module.exports = { runInstall };
