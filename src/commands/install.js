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
const { CONFIG_FILE, LEGACY_CONFIG_FILE, activeZones, readWorkflowConfig, updateWorkflowConfig } = require('../lib/workflow-config');

const WORKSPACE = process.cwd();

const TOOL_CHOICES = TOOL_IDS.map((id) => ({ title: getAdapter(id).label, value: id }));

/**
 * Set `auto_handover` in amlog-workflow.config.json: from --auto-handover /
 * --no-auto-handover if given, otherwise ask once. An existing value is kept
 * unless a flag overrides it; with no flag and no prompt, nothing is written
 * and agents fall back to the default (ask before each handoff).
 *
 * @param {string} workspaceDir
 * @param {object} opts - CLI options
 */
async function configureAutoHandover(workspaceDir, opts) {
  const current = readWorkflowConfig(workspaceDir).auto_handover;
  let value;
  if (typeof opts.autoHandover === 'boolean') {
    value = opts.autoHandover;
  } else if (typeof current === 'boolean' || !canPrompt(opts)) {
    return;
  } else {
    const { auto } = await prompts({
      type: 'confirm',
      name: 'auto',
      message: 'Let agents hand off to each other automatically? (you are still asked at mandatory gates: AC, instructions file, plan, visual check, test cases)',
      initial: false,
    });
    if (typeof auto !== 'boolean') return;
    value = auto;
  }
  if (value === current) return;
  updateWorkflowConfig(workspaceDir, { auto_handover: value });
  console.log(chalk.green(`  ✓ Set auto_handover: ${value} in ${CONFIG_FILE}`));
}

// The example file is no longer shipped; earlier installs left copies behind.
const STALE_EXAMPLE_FILES = [
  'amlog-workflow.config.example.json',
  path.join('.amlog', 'amlog-workflow.config.example.json'),
];

const CONFIG_DEFAULTS = {
  adapter: 'codegraph',
  // null = placeholder for the user to fill in (e.g. "./frontend"); unset zones are ignored
  zones: { frontend: null, backend: null, database: null, qa: './e2e-full-cycle' },
  businessDocs: './docs/business',
  auto_handover: false,
  max_handoff_repeats: 3,
};

/**
 * Create amlog-workflow.config.json with defaults, or add any missing default
 * keys to an existing one. Existing values are never overwritten.
 *
 * @param {string} workspaceDir
 */
function ensureWorkflowConfig(workspaceDir) {
  const existed = fs.existsSync(path.join(workspaceDir, CONFIG_FILE))
    || fs.existsSync(path.join(workspaceDir, LEGACY_CONFIG_FILE));
  const current = readWorkflowConfig(workspaceDir);
  const missing = Object.keys(CONFIG_DEFAULTS).filter((k) => !(k in current));
  if (existed && missing.length === 0) return;
  const patch = {};
  for (const k of missing) patch[k] = CONFIG_DEFAULTS[k];
  updateWorkflowConfig(workspaceDir, patch);
  console.log(chalk.green(`  ✓ ${existed ? 'Updated' : 'Wrote'} ${CONFIG_FILE}`));
}

/**
 * Remove example config files written by earlier installs.
 *
 * @param {string} workspaceDir
 */
function removeStaleConfigExamples(workspaceDir) {
  for (const f of STALE_EXAMPLE_FILES) fs.removeSync(path.join(workspaceDir, f));
}

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
  if (activeZones(readWorkflowConfig(WORKSPACE)).length === 0 && canPrompt(opts)) {
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
        updateWorkflowConfig(WORKSPACE, { zones: zoneMap });
      }
    }
  }

  // 5b'. Ship the config file for every install (not just multi-zone repos);
  // only keys that are missing get filled, so existing settings are kept.
  ensureWorkflowConfig(WORKSPACE);
  removeStaleConfigExamples(WORKSPACE);

  // 5c. Agent-to-agent handoff mode
  await configureAutoHandover(WORKSPACE, opts);

  // 6. Bootstrap knowledge base
  await bootstrapKnowledgeBase(WORKSPACE, targetTools, opts);

  // 7. Summary
  console.log(chalk.bold.green(`\n✅ Done! ${ok.length} agent install(s) completed.\n`));
  if (failed.length > 0) {
    console.log(chalk.yellow(`  ⚠  ${failed.length} agent install(s) failed — check errors above.\n`));
  }
}

module.exports = { runInstall };
