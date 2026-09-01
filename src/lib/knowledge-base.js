'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

const CONFIG_FILE = 'amlog-workflow.config.json';

// Pinned CodeGraph release known to work with this amlog version. Bump deliberately
// (and re-test `amlog install`) rather than always tracking upstream's latest/main.
const PINNED_CODEGRAPH_VERSION = '1.6.0';

let cachedCommand = null;

/**
 * Get the command or full path to execute codegraph.
 * If codegraph is on the PATH, returns 'codegraph'.
 * Otherwise, checks common installation directories to resolve the path dynamically.
 * Resolved once per process and cached.
 * @returns {string}
 */
function getCodegraphCommand() {
  if (cachedCommand) return cachedCommand;

  try {
    // If it's on PATH, use it directly
    execSync('codegraph --version', { stdio: 'ignore' });
    cachedCommand = 'codegraph';
  } catch {
    // Try to find it in common default installation folders
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
      const winPath = path.join(localAppData, 'codegraph', 'current', 'codegraph.cmd');
      const winPathExe = path.join(localAppData, 'codegraph', 'current', 'codegraph.exe');
      const npmPath = path.join(process.env.APPDATA || '', 'npm', 'codegraph.cmd');
      if (fs.existsSync(winPath)) cachedCommand = winPath;
      else if (fs.existsSync(winPathExe)) cachedCommand = winPathExe;
      else if (fs.existsSync(npmPath)) cachedCommand = npmPath; // Check npm global paths
    } else {
      const home = process.env.HOME || '';
      const unixPath = path.join(home, '.codegraph', 'bin', 'codegraph');
      if (fs.existsSync(unixPath)) cachedCommand = unixPath;
    }
    if (!cachedCommand) cachedCommand = 'codegraph'; // Fallback
  }

  return cachedCommand;
}

/**
 * Check if codegraph CLI is installed.
 * @returns {boolean}
 */
function isCodegraphInstalled() {
  const cmd = getCodegraphCommand();
  try {
    execSync(`"${cmd}" --version`, { stdio: 'ignore' });
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

  // Both installer scripts honor CODEGRAPH_VERSION to pin a release instead of
  // tracking latest/main (see PINNED_CODEGRAPH_VERSION above).
  const installerEnv = { ...process.env, CODEGRAPH_VERSION: `v${PINNED_CODEGRAPH_VERSION}` };

  if (!isWindows) {
    // Try curl first
    const curlCheck = spawnSync('which', ['curl'], { stdio: 'ignore' });
    if (curlCheck.status === 0) {
      const result = spawnSync(
        'sh',
        ['-c', 'curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh'],
        { stdio: 'inherit', env: installerEnv }
      );
      if (result.status === 0) { cachedCommand = null; return; }
    }
  } else {
    // Try irm/iex on Windows
    const result = spawnSync(
      'powershell',
      ['-Command', 'irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex'],
      { stdio: 'inherit', env: installerEnv }
    );
    if (result.status === 0) { cachedCommand = null; return; }
  }

  // Fallback: npm. `which` isn't a native Windows command, so probe npm directly
  // (with shell: true since npm is a .cmd shim on Windows) instead of pre-checking via `which`.
  const npmCheck = spawnSync('npm', ['--version'], { stdio: 'ignore', shell: true });
  if (npmCheck.status === 0) {
    console.log(chalk.gray('  Falling back to npm install...'));
    const result = spawnSync(
      'npm',
      ['i', '-g', `@colbymchenry/codegraph@${PINNED_CODEGRAPH_VERSION}`],
      { stdio: 'inherit', shell: true }
    );
    if (result.status !== 0) throw new Error('Failed to install CodeGraph via npm.');
    cachedCommand = null;
    return;
  }

  throw new Error('Neither curl nor npm available. Cannot install CodeGraph automatically.');
}

/**
 * Wire CodeGraph MCP server into detected agent CLIs.
 */
function wireCodegraph() {
  console.log(chalk.cyan('  Wiring CodeGraph into detected agent CLIs...'));
  const cmd = getCodegraphCommand();
  const result = spawnSync(
    cmd,
    ['install', '--target=auto', '--location=global', '--yes'],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.log(chalk.yellow('  WARNING: failed to wire CodeGraph into agent CLIs.'));
  }
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
  const cmd = getCodegraphCommand();
  for (const zone of zones) {
    const target = path.resolve(workspaceDir, zone);
    if (!fs.existsSync(target)) {
      console.log(chalk.yellow(`  WARNING: zone '${zone}' does not exist, skipping.`));
      continue;
    }
    console.log(chalk.cyan(`  Indexing zone: ${zone}`));
    spawnSync(cmd, ['init'], { cwd: target, stdio: 'inherit' });
  }
}

/**
 * Print `codegraph status` for each zone.
 *
 * @param {string[]} zones
 * @param {string} workspaceDir
 */
function printZoneStatus(zones, workspaceDir) {
  const cmd = getCodegraphCommand();
  for (const zone of zones) {
    const target = path.resolve(workspaceDir, zone);
    if (!fs.existsSync(target)) continue;
    console.log(chalk.bold(`\n  --- ${zone} ---`));
    spawnSync(cmd, ['status'], { cwd: target, stdio: 'inherit' });
  }
}

/**
 * Re-index configured zones and print status, without touching CodeGraph's own
 * install/wiring. Used by `amlog update` so zones added to
 * amlog-workflow.config.json after initial install get indexed without a full
 * uninstall/reinstall.
 *
 * @param {string} workspaceDir
 */
function syncZones(workspaceDir) {
  const zones = readZones(workspaceDir);
  initZones(zones, workspaceDir);
  printZoneStatus(zones, workspaceDir);
}

/**
 * Full knowledge-base bootstrap sequence.
 * Mirrors the reference shell script from AGENTS.md Appendix A.
 *
 * @param {string} workspaceDir
 */
async function bootstrapKnowledgeBase(workspaceDir) {
  console.log(chalk.bold.cyan('\n📚 Bootstrapping knowledge base...\n'));

  const cmd = getCodegraphCommand();

  // Step 1: Ensure CodeGraph is installed
  if (isCodegraphInstalled()) {
    console.log(chalk.green('  ✓ CodeGraph CLI already installed.'));
    // Check for updates (non-fatal)
    const upgradeCheck = spawnSync(cmd, ['upgrade', '--check'], { stdio: 'inherit' });
    if (upgradeCheck.status !== 0) {
      console.log(chalk.yellow('  WARNING: failed to check for CodeGraph updates.'));
    }
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
  syncZones,
  bootstrapKnowledgeBase,
  getCodegraphCommand,
};
