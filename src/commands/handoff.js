'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const { checkHandoff, recordHandoff, resetHandoffs, summarizeHandoffs, logPath } = require('../lib/handoff-log');
const { getHandoffSettings, CONFIG_FILE } = require('../lib/workflow-config');

/**
 * Agents may call this from a sub-folder of the workspace (e.g. a zone), so
 * walk up to the nearest folder holding `.amlog/` or the workflow config.
 *
 * @param {string} startDir
 * @returns {string}
 */
function findWorkspaceRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.amlog')) || fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

function requireOpts(opts, keys) {
  const missing = keys.filter((k) => !opts[k]);
  if (missing.length > 0) {
    console.error(chalk.red(`  Missing required option(s): ${missing.map((k) => `--${k}`).join(', ')}`));
    process.exit(2);
  }
}

const DECISION_HINT = {
  PROCEED: 'auto_handover is on — record this handoff, then hand off now without asking.',
  CONFIRM: 'auto_handover is off — ask the user to confirm this handoff, then record it and hand off.',
  ASK_HUMAN: 'Loop limit reached — do NOT hand off. Stop and ask a human, ending with a `HUMAN INPUT REQUIRED:` line.',
};

// Output is plain `KEY: value` lines on purpose: it's read by agents, not people.
function runCheck(workspace, opts) {
  requireOpts(opts, ['issue', 'from', 'to']);
  const r = checkHandoff(workspace, opts);
  console.log(`DECISION: ${r.decision}`);
  console.log(`attempt: ${r.attempt}/${r.maxHandoffRepeats} (${r.from} -> ${r.to}, issue ${r.issue})`);
  console.log(`auto_handover: ${r.autoHandover}`);
  if (r.prior.length > 0) {
    console.log('previous attempts:');
    r.prior.forEach((e, i) => console.log(`  ${i + 1}. ${e.at} — ${e.reason || '(no reason recorded)'}`));
  }
  console.log(`next: ${DECISION_HINT[r.decision]}`);
}

function runRecord(workspace, opts) {
  requireOpts(opts, ['issue', 'from', 'to']);
  const r = recordHandoff(workspace, opts);
  const note = opts.humanApproved ? ' (human-approved — repeat count reset for this pair)' : '';
  console.log(`RECORDED: ${r.from} -> ${r.to}, issue ${r.issue}${note}`);
}

function runReset(workspace, opts) {
  requireOpts(opts, ['issue']);
  const r = resetHandoffs(workspace, opts);
  const scope = r.from === '*' ? 'every handoff pair' : `${r.from} -> ${r.to}`;
  console.log(`RESET: ${scope}, issue ${r.issue}`);
}

function runStatus(workspace, opts) {
  const { autoHandover, maxHandoffRepeats } = getHandoffSettings(workspace);
  console.log(`auto_handover: ${autoHandover}`);
  console.log(`max_handoff_repeats: ${maxHandoffRepeats}`);
  if (!opts.issue) return;
  const pairs = summarizeHandoffs(workspace, opts.issue);
  if (pairs.length === 0) {
    console.log(`No handoffs recorded for issue ${opts.issue} (${path.relative(workspace, logPath(workspace, opts.issue))}).`);
    return;
  }
  console.log(`handoffs for issue ${opts.issue} (count since last reset):`);
  for (const p of pairs) {
    const flag = p.count + 1 >= maxHandoffRepeats ? '  ← next repeat needs a human' : '';
    console.log(`  ${p.count}/${maxHandoffRepeats}  ${p.from} -> ${p.to}${flag}`);
  }
}

const ACTIONS = { check: runCheck, record: runRecord, reset: runReset, status: runStatus };

/**
 * `amlog handoff <action>` — loop guard for agent-to-agent handoffs.
 *
 * @param {string} action - check | record | reset | status
 * @param {object} opts
 */
async function runHandoff(action, opts) {
  const fn = ACTIONS[action];
  if (!fn) {
    console.error(chalk.red(`  Unknown handoff action "${action}". Expected one of: ${Object.keys(ACTIONS).join(', ')}`));
    process.exit(2);
  }
  try {
    fn(findWorkspaceRoot(process.cwd()), opts);
  } catch (err) {
    console.error(chalk.red(`  ${err.message}`));
    process.exit(2);
  }
}

module.exports = { runHandoff, findWorkspaceRoot };
