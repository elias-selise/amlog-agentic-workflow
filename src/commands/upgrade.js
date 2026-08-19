'use strict';

const { spawnSync } = require('child_process');
const chalk = require('chalk');

/**
 * `amlog upgrade [version]` — update the amlog CLI itself via npm.
 */
async function runUpgrade(version) {
  console.log(chalk.bold.cyan('\n⬆  amlog upgrade\n'));

  const pkg = version ? `amlog-workflow@${version}` : 'amlog-workflow@latest';
  console.log(chalk.gray(`  Running: npm i -g ${pkg}\n`));

  const result = spawnSync('npm', ['i', '-g', pkg], { stdio: 'inherit' });

  if (result.status === 0) {
    console.log(chalk.bold.green('\n✅ amlog upgraded successfully.\n'));
  } else {
    console.log(chalk.bold.red('\n❌ Upgrade failed. Check npm output above.\n'));
    process.exit(1);
  }
}

module.exports = { runUpgrade };
