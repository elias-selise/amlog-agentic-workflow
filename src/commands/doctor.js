'use strict';

const os = require('os');
const path = require('path');
const chalk = require('chalk');
const fs = require('fs-extra');
const { getCodegraphCommand, isCodegraphInstalled } = require('../lib/knowledge-base');
const { detectAgentInstructionFile } = require('../lib/detect-agent-cli');

const WORKSPACE = process.cwd();

function ok(label, detail) {
  console.log(chalk.green(`  ✓ ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
}

function fail(label, detail) {
  console.log(chalk.red(`  ✗ ${label}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
}

/**
 * `amlog doctor` — diagnose the local environment: Node version, resolved
 * CodeGraph command/path, and the detected agent-instruction file. Meant to
 * make cross-platform install issues (e.g. Windows PATH resolution) fast to
 * triage from a bug report.
 */
async function runDoctor() {
  console.log(chalk.bold.cyan('\n🩺 amlog doctor\n'));

  console.log(chalk.bold('  Environment:'));
  ok('Node.js', process.version);
  ok('Platform', `${process.platform} (${os.arch()})`);
  console.log();

  console.log(chalk.bold('  CodeGraph:'));
  const cmd = getCodegraphCommand();
  console.log(chalk.gray(`  Resolved command: ${cmd}`));
  if (isCodegraphInstalled()) {
    ok('CodeGraph reachable');
  } else {
    fail('CodeGraph not reachable', 'run `amlog install` to install it');
  }
  console.log();

  console.log(chalk.bold('  Workspace:'));
  const instrFile = detectAgentInstructionFile(WORKSPACE);
  if (instrFile) {
    ok('Agent instruction file', path.relative(WORKSPACE, instrFile));
  } else {
    fail('No agent instruction file found', 'AGENTS.md / CLAUDE.md / GEMINI.md / CURSOR.md');
  }

  const stateFile = path.join(WORKSPACE, '.amlog', 'state.json');
  if (fs.existsSync(stateFile)) {
    ok('.amlog/state.json present', 'agents installed — see `amlog status`');
  } else {
    fail('.amlog/state.json missing', 'run `amlog install` in this workspace');
  }

  const legacyDir = path.join(WORKSPACE, '.amlog', 'agents');
  if (fs.existsSync(legacyDir)) {
    fail('Legacy .amlog/agents/ found', 'run `amlog install` or `amlog update` to migrate');
  }
  console.log();
}

module.exports = { runDoctor };
