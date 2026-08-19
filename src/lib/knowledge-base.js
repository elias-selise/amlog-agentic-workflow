'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

const CONFIG_FILE = 'amlog-workflow.config.json';

/**
 * Check if codegraph CLI is installed.
 * @returns {boolean}
 */
function isCodegraphInstalled() {
  try {
    execSync('codegraph --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install CodeGraph CLI using the best available method.
 */
function installCodegraph() {
  const isWindows = process.platform === 'win32';
  console.log(chalk.cyan('  Installing CodeGraph CLI...'));

  if (!isWindows) {
    // Try curl first
    const curlCheck = spawnSync('which', ['curl'], { stdio: 'ignore' });
    if (curlCheck.status === 0) {
      const result = spawnSync(
        'sh',
        ['-c', 'curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh'],
        { stdio: 'inherit' }
      );
      if (result.status === 0) return;
    }
  } else {
    // Try irm/iex on Windows
    const result = spawnSync(
      'powershell',
      ['-Command', 'irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex'],
      { stdio: 'inherit' }
    );
    if (result.status === 0) return;
  }

  // Fallback: npm
  const npmCheck = spawnSync('which', ['npm'], { stdio: 'ignore' });
  if (npmCheck.status === 0) {
    console.log(chalk.gray('  Falling back to npm install...'));
    const result = spawnSync('npm', ['i', '-g', '@colbymchenry/codegraph'], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Failed to install CodeGraph via npm.');
    return;
  }

  throw new Error('Neither curl nor npm available. Cannot install CodeGraph automatically.');
}

/**
 * Wire CodeGraph MCP server into detected agent CLIs.
 */
function wireCodegraph() {
  console.log(chalk.cyan('  Wiring CodeGraph into detected agent CLIs...'));
  spawnSync(
    'codegraph',
    ['install', '--target=auto', '--location=global', '--yes'],
    { stdio: 'inherit' }
  );
}

/**
 * Read zones from amlog-workflow.config.json, or return ['.'] as fallback.
 *
 * @param {string} workspaceDir
 * @returns {string[]}
 */
function readZones(workspaceDir) {
  const configPath = path.join(workspaceDir, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow(
      `  No ${CONFIG_FILE} found. Indexing repo root as a single zone.\n` +
      `  Tip: add a ${CONFIG_FILE} if this is a multi-zone repo (frontend + backend).`
    ));
    return ['.'];
  }

  const cfg = fs.readJsonSync(configPath);
  const zones = Object.values(cfg.zones || {});
  if (zones.length === 0) return ['.'];
  return zones;
}

/**
 * Run `codegraph init` in each zone directory.
 *
 * @param {string[]} zones       - zone paths relative to workspaceDir
 * @param {string} workspaceDir
 */
function initZones(zones, workspaceDir) {
  for (const zone of zones) {
    const target = path.resolve(workspaceDir, zone);
    if (!fs.existsSync(target)) {
      console.log(chalk.yellow(`  WARNING: zone '${zone}' does not exist, skipping.`));
      continue;
    }
    console.log(chalk.cyan(`  Indexing zone: ${zone}`));
    spawnSync('codegraph', ['init'], { cwd: target, stdio: 'inherit' });
  }
}

/**
 * Print `codegraph status` for each zone.
 *
 * @param {string[]} zones
 * @param {string} workspaceDir
 */
function printZoneStatus(zones, workspaceDir) {
  for (const zone of zones) {
    const target = path.resolve(workspaceDir, zone);
    if (!fs.existsSync(target)) continue;
    console.log(chalk.bold(`\n  --- ${zone} ---`));
    spawnSync('codegraph', ['status'], { cwd: target, stdio: 'inherit' });
  }
}

/**
 * Full knowledge-base bootstrap sequence.
 * Mirrors the reference shell script from AGENTS.md Appendix A.
 *
 * @param {string} workspaceDir
 */
async function bootstrapKnowledgeBase(workspaceDir) {
  console.log(chalk.bold.cyan('\n📚 Bootstrapping knowledge base...\n'));

  // Step 1: Ensure CodeGraph is installed
  if (isCodegraphInstalled()) {
    console.log(chalk.green('  ✓ CodeGraph CLI already installed.'));
    // Check for updates (non-fatal)
    spawnSync('codegraph', ['upgrade', '--check'], { stdio: 'inherit' });
  } else {
    installCodegraph();
  }

  // Step 2: Wire into agent CLIs
  wireCodegraph();

  // Step 3: Init zones
  const zones = readZones(workspaceDir);
  initZones(zones, workspaceDir);

  // Step 4: Print status
  console.log(chalk.bold.cyan('\n📊 Knowledge base index status:\n'));
  printZoneStatus(zones, workspaceDir);
}

module.exports = {
  isCodegraphInstalled,
  installCodegraph,
  wireCodegraph,
  readZones,
  initZones,
  printZoneStatus,
  bootstrapKnowledgeBase,
};
