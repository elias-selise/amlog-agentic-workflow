'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const { confirm } = require('./prompt-utils');

const CONFIG_FILE = 'amlog-workflow.config.json';

// Files whose presence in an immediate subdirectory suggests it's its own
// sub-project (a plausible separate CodeGraph zone), e.g. a frontend/ dir
// with its own package.json alongside a backend/ dir with its own .csproj.
const ZONE_MARKER_FILES = ['package.json', 'go.mod', 'pom.xml'];
const ZONE_MARKER_EXTENSIONS = ['.csproj', '.sln'];

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
 * Describe the install method that will be tried first for this OS, for
 * display to the user before anything actually runs.
 * @returns {string}
 */
function describeInstallMethod() {
  return process.platform === 'win32'
    ? 'irm | iex (PowerShell), falling back to npm if that fails'
    : 'curl | sh, falling back to npm if that fails';
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
 * Check whether CodeGraph's MCP server is already wired into a specific
 * agent CLI's own global config file (e.g. ~/.claude.json for `claude`).
 * Asks CodeGraph itself where that config lives (`--print-config`) instead
 * of hardcoding per-tool/per-OS paths, since CodeGraph owns that mapping.
 *
 * @param {string} toolId - e.g. 'claude', 'codex', 'opencode', 'antigravity'
 * @returns {boolean}
 */
function isCodegraphWiredForTool(toolId) {
  const cmd = getCodegraphCommand();
  const result = spawnSync(cmd, ['install', '--print-config', toolId], { encoding: 'utf8' });
  if (result.status !== 0) return false;

  const match = (result.stdout || '').match(/# Add to (.+)/);
  if (!match) return false;

  const configPath = match[1].trim();
  if (!fs.existsSync(configPath)) return false;

  try {
    return fs.readFileSync(configPath, 'utf8').includes('codegraph');
  } catch {
    return false;
  }
}

/**
 * Wire CodeGraph MCP server into agent CLIs. When `targetTools` is given,
 * only wires the tools among them that aren't already wired (skipping the
 * shell-out entirely if all of them already are); otherwise falls back to
 * `--target=auto`, letting CodeGraph detect and wire whatever it finds.
 *
 * @param {string[]} [targetTools]
 */
function wireCodegraph(targetTools = []) {
  const cmd = getCodegraphCommand();

  if (targetTools.length > 0) {
    const toWire = targetTools.filter((t) => !isCodegraphWiredForTool(t));
    if (toWire.length === 0) {
      console.log(chalk.green(`  ✓ CodeGraph already wired for: ${targetTools.join(', ')}`));
      return;
    }
    console.log(chalk.cyan(`  Wiring CodeGraph into: ${toWire.join(', ')}...`));
    const result = spawnSync(
      cmd,
      ['install', `--target=${toWire.join(',')}`, '--location=global', '--yes'],
      { stdio: 'inherit' }
    );
    if (result.status !== 0) {
      console.log(chalk.yellow('  WARNING: failed to wire CodeGraph into agent CLIs.'));
    }
    return;
  }

  console.log(chalk.cyan('  Wiring CodeGraph into detected agent CLIs...'));
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
 * Scan immediate subdirectories of workspaceDir for their own project marker
 * file (package.json, go.mod, pom.xml, *.csproj, *.sln), suggesting each is a
 * separate sub-project that could be its own CodeGraph zone.
 *
 * @param {string} workspaceDir
 * @returns {string[]} relative subdirectory names that look like separate zones
 */
function detectPlausibleZones(workspaceDir) {
  let entries;
  try {
    entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const dir = path.join(workspaceDir, entry.name);
    let dirEntries;
    try {
      dirEntries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const hasMarker = dirEntries.some((f) =>
      ZONE_MARKER_FILES.includes(f) || ZONE_MARKER_EXTENSIONS.includes(path.extname(f))
    );
    if (hasMarker) candidates.push(entry.name);
  }
  return candidates;
}

/**
 * Full knowledge-base bootstrap sequence.
 * Mirrors the reference shell script from AGENTS.md Appendix A.
 *
 * @param {string} workspaceDir
 * @param {string[]} [targetTools] - tool ids to wire CodeGraph into (only the ones not already wired)
 * @param {{ yes?: boolean }} [opts]
 */
async function bootstrapKnowledgeBase(workspaceDir, targetTools = [], opts = {}) {
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
    const proceed = await confirm(
      opts,
      `CodeGraph CLI not found. Install it now via ${describeInstallMethod()}?`
    );
    if (!proceed) {
      console.log(chalk.yellow(
        '  Skipped — re-run `amlog install` (or `amlog update`) later to set up the knowledge base.'
      ));
      return;
    }
    installCodegraph();
  }

  // Step 2: Wire into agent CLIs (only the tools that aren't already wired)
  wireCodegraph(targetTools);

  // Step 3: Init zones
  const zones = readZones(workspaceDir);
  initZones(zones, workspaceDir);

  // Step 4: Print status
  console.log(chalk.bold.cyan('\n📊 Knowledge base index status:\n'));
  printZoneStatus(zones, workspaceDir);
}

module.exports = {
  isCodegraphInstalled,
  isCodegraphWiredForTool,
  installCodegraph,
  wireCodegraph,
  readZones,
  initZones,
  printZoneStatus,
  syncZones,
  bootstrapKnowledgeBase,
  getCodegraphCommand,
  detectPlausibleZones,
};
