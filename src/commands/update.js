'use strict';

const chalk = require('chalk');
const ora = require('ora');
const semver = require('semver');
const { filterAgents, loadManifest } = require('../lib/manifest');
const { installAgents, getInstalledTypes, getInstalledTools } = require('../lib/copy-agents');
const { getAdapter } = require('../lib/adapters');
const { isCodegraphInstalled, syncZones } = require('../lib/knowledge-base');
const { ensureGitignoreEntries } = require('../lib/gitignore');
const { runMigration } = require('../lib/migrate');
const { runUpgrade, getLatestVersion } = require('./upgrade');
const { version: currentVersion } = require('../../package.json');
const { confirm } = require('../lib/prompt-utils');

const WORKSPACE = process.cwd();

/**
 * Check npm for a newer amlog CLI release and self-upgrade in place if found.
 * Non-fatal: a failed registry lookup just skips the check.
 *
 * @param {object} [opts] - CLI options (checks opts.yes)
 */
async function selfUpdateCli(opts = {}) {
  console.log(chalk.bold.cyan('\n⬆  Checking for amlog CLI updates...\n'));

  const latest = getLatestVersion();
  if (!latest) {
    console.log(chalk.yellow('  Could not reach npm registry — skipping CLI update check.'));
    return;
  }

  if (semver.valid(latest) && semver.gt(latest, currentVersion)) {
    console.log(chalk.yellow(`  New version available: ${currentVersion} → ${latest}`));
    const proceed = await confirm(opts, `Upgrade amlog CLI ${currentVersion} → ${latest} now?`);
    if (proceed) {
      await runUpgrade();
    } else {
      console.log(chalk.yellow('  Skipped — run `amlog upgrade` later.'));
    }
  } else {
    console.log(chalk.green(`  ✓ amlog CLI is up to date (${currentVersion}).`));
  }
}

/**
 * `amlog update` — re-pulls latest agent definitions for already-installed roles/tools.
 */
async function runUpdate(opts) {
  console.log(chalk.bold.cyan('\n🔄 amlog update\n'));

  await selfUpdateCli(opts);
  await runMigration(WORKSPACE, { yes: opts.yes });

  const installedTypes = getInstalledTypes(WORKSPACE);
  const installedTools = getInstalledTools(WORKSPACE);
  if (installedTypes.length === 0 || installedTools.length === 0) {
    console.log(chalk.yellow('  No agents installed in this workspace. Run `amlog install` first.'));
    return;
  }

  console.log(chalk.gray(`  Re-pulling agents for types: ${installedTypes.join(', ')}`));
  console.log(chalk.gray(`  Tools: ${installedTools.map((t) => getAdapter(t).label).join(', ')}\n`));

  const agents = filterAgents(installedTypes);
  const { agents: allAgents } = loadManifest();
  const spinner = ora('Updating agents...').start();
  const results = await installAgents(agents, installedTools, WORKSPACE, allAgents);
  spinner.stop();

  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  ok.forEach(r => console.log(chalk.green(`  ✓ [${r.tool}] ${r.agent.type}/${r.agent.name}`)));
  failed.forEach(r => console.log(chalk.red(`  ✗ [${r.tool}] ${r.agent.type}/${r.agent.name}: ${r.error}`)));

  ensureGitignoreEntries(WORKSPACE);

  // Re-index zones so changes to amlog-workflow.config.json (e.g. a newly added
  // zone) take effect without a full uninstall/reinstall.
  if (isCodegraphInstalled()) {
    console.log(chalk.bold.cyan('\n📚 Syncing knowledge base zones...\n'));
    syncZones(WORKSPACE);
  }

  console.log(chalk.bold.green(`\n✅ Update complete. ${ok.length} agent install(s) refreshed.\n`));
}

module.exports = { runUpdate };
