'use strict';

const { execSync, spawnSync } = require('child_process');
const chalk = require('chalk');

const PACKAGE_NAME = 'amlog-workflow';
// Package was renamed from the scoped name below to the unscoped one above
// (see git history). Anyone who installed globally before the rename has an
// `amlog` bin symlink owned by this old package name, which makes npm refuse
// to link the new package's bin ("EEXIST: file already exists") and silently
// aborts the upgrade. Remove it first so the new package can claim the bin.
const LEGACY_PACKAGE_NAMES = ['@selise/amlog-workflow'];

const isWindows = process.platform === 'win32';

/**
 * Remove any legacy globally-installed package names that would otherwise
 * collide with this package's `amlog` bin symlink.
 */
function removeLegacyPackages() {
  for (const name of LEGACY_PACKAGE_NAMES) {
    const check = spawnSync('npm', ['ls', '-g', name, '--depth=0'], { stdio: 'ignore', shell: isWindows });
    if (check.status === 0) {
      console.log(chalk.gray(`  Removing legacy global package ${name} to avoid a bin conflict...`));
      spawnSync('npm', ['uninstall', '-g', name], { stdio: 'inherit', shell: isWindows });
    }
  }
}

/**
 * Look up the latest published version of the CLI on npm.
 * @returns {string|null} version string, or null if the registry couldn't be reached
 */
function getLatestVersion() {
  try {
    return execSync(`npm view ${PACKAGE_NAME} version`, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * `amlog upgrade [version]` — update the amlog CLI itself via npm.
 */
async function runUpgrade(version) {
  console.log(chalk.bold.cyan('\n⬆  amlog upgrade\n'));

  removeLegacyPackages();

  const pkg = version ? `${PACKAGE_NAME}@${version}` : `${PACKAGE_NAME}@latest`;
  console.log(chalk.gray(`  Running: npm i -g ${pkg}\n`));

  const result = spawnSync('npm', ['i', '-g', pkg], { stdio: 'inherit', shell: isWindows });

  if (result.status === 0) {
    console.log(chalk.bold.green('\n✅ amlog upgraded successfully.\n'));
  } else {
    console.log(chalk.bold.red('\n❌ Upgrade failed. Check npm output above.\n'));
    console.log(chalk.yellow(
      '  If this mentions EACCES/permission, your global npm prefix needs sudo\n' +
      '  (or switch to nvm so global installs don\'t require elevated permissions).'
    ));
    process.exit(1);
  }
}

module.exports = { runUpgrade, getLatestVersion, PACKAGE_NAME };
