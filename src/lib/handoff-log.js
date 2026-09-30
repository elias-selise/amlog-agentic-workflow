'use strict';

const path = require('path');
const fs = require('fs-extra');
const { getHandoffSettings } = require('./workflow-config');

// One plain-text log per issue, one line per handoff, so agents without a
// shell (Read/Write only) can read, count and append to it by hand:
//   <ISO time> | <from> (<type>) -> <to> (<type>) | <reason>
// A line whose reason starts with a reset marker restarts the count for its
// pair; `* -> *` resets every pair of that issue.
const HUMAN_APPROVED = '[human-approved]';
const RESET = '[reset]';
const ANY = '*';

function handoffDir(workspaceDir) {
  return path.join(workspaceDir, '.amlog', 'handoffs');
}

/**
 * Normalize an issue number / story name into a safe log file key.
 *
 * @param {string|number} issue
 * @returns {string}
 */
function issueKey(issue) {
  const key = String(issue || '').trim().replace(/^#/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!key) throw new Error('An issue number or story name is required (--issue).');
  return key;
}

function logPath(workspaceDir, issue) {
  return path.join(handoffDir(workspaceDir), `${issueKey(issue)}.log`);
}

/**
 * Normalize `name/type`, `name:type`, `name (type)` or a bare `name` into the
 * canonical `name (type)` form used in the log.
 *
 * @param {string} ref
 * @returns {string}
 */
function normalizeAgent(ref) {
  const raw = String(ref || '').trim();
  if (raw === ANY) return ANY;
  const m = /^([\w.-]+?)(?:--([\w-]+))?\s*(?:[/:]\s*([\w-]+)|\(\s*([\w|-]+)\s*\))?$/.exec(raw);
  if (!m) throw new Error(`Unrecognized agent reference: "${ref}" (expected <name>/<type>).`);
  const [, name, suffixType, slashType, parenType] = m;
  const type = slashType || parenType || suffixType;
  return type ? `${name} (${type})` : name;
}

function parseLine(line) {
  const parts = line.split(' | ');
  if (parts.length < 2) return null;
  const pair = /^(.+?) -> (.+)$/.exec(parts[1].trim());
  if (!pair) return null;
  const reason = parts.slice(2).join(' | ').trim();
  return { at: parts[0].trim(), from: pair[1].trim(), to: pair[2].trim(), reason };
}

/**
 * @param {string} workspaceDir
 * @param {string|number} issue
 * @returns {{at: string, from: string, to: string, reason: string}[]}
 */
function readEntries(workspaceDir, issue) {
  const p = logPath(workspaceDir, issue);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).map(parseLine).filter(Boolean);
}

function isResetFor(entry, from, to) {
  const marker = entry.reason.startsWith(HUMAN_APPROVED) || entry.reason.startsWith(RESET);
  if (!marker) return false;
  return (entry.from === ANY && entry.to === ANY) || (entry.from === from && entry.to === to);
}

/**
 * Plain (non-reset) handoffs for this pair since its last reset marker.
 *
 * @returns {{at: string, from: string, to: string, reason: string}[]}
 */
function repeatsSinceReset(entries, from, to) {
  let start = 0;
  entries.forEach((e, i) => { if (isResetFor(e, from, to)) start = i + 1; });
  return entries.slice(start).filter((e) => e.from === from && e.to === to);
}

/**
 * Decide whether a handoff may happen now.
 *   PROCEED   — under the repeat limit and auto_handover is on
 *   CONFIRM   — under the repeat limit, but auto_handover is off: ask the user first
 *   ASK_HUMAN — this would be the Nth repeat of the same handoff: stop for a human
 *
 * @param {string} workspaceDir
 * @param {{issue: string, from: string, to: string}} args
 */
function checkHandoff(workspaceDir, { issue, from, to }) {
  const f = normalizeAgent(from);
  const t = normalizeAgent(to);
  const { autoHandover, maxHandoffRepeats } = getHandoffSettings(workspaceDir);
  const prior = repeatsSinceReset(readEntries(workspaceDir, issue), f, t);
  const attempt = prior.length + 1;

  let decision;
  if (attempt >= maxHandoffRepeats) decision = 'ASK_HUMAN';
  else decision = autoHandover ? 'PROCEED' : 'CONFIRM';

  return { decision, issue: issueKey(issue), from: f, to: t, attempt, maxHandoffRepeats, autoHandover, prior };
}

function appendLine(workspaceDir, issue, from, to, reason) {
  const clean = String(reason || '').replace(/\r?\n/g, ' ').trim();
  const line = `${new Date().toISOString()} | ${from} -> ${to} | ${clean}\n`;
  fs.ensureDirSync(handoffDir(workspaceDir));
  fs.appendFileSync(logPath(workspaceDir, issue), line, 'utf8');
}

/**
 * Record a handoff that is actually happening. With `humanApproved`, the
 * record doubles as a reset marker: a human looked at the loop and said go
 * on, so the pair's count starts over from this point.
 *
 * @param {string} workspaceDir
 * @param {{issue: string, from: string, to: string, reason?: string, humanApproved?: boolean}} args
 */
function recordHandoff(workspaceDir, { issue, from, to, reason, humanApproved }) {
  const f = normalizeAgent(from);
  const t = normalizeAgent(to);
  appendLine(workspaceDir, issue, f, t, humanApproved ? `${HUMAN_APPROVED} ${reason || ''}` : reason);
  return { issue: issueKey(issue), from: f, to: t };
}

/**
 * Reset the repeat count for one pair, or for every pair of the issue when
 * `from`/`to` are omitted.
 */
function resetHandoffs(workspaceDir, { issue, from, to, reason }) {
  const f = from ? normalizeAgent(from) : ANY;
  const t = to ? normalizeAgent(to) : ANY;
  appendLine(workspaceDir, issue, f, t, `${RESET} ${reason || ''}`);
  return { issue: issueKey(issue), from: f, to: t };
}

/**
 * Current repeat count per pair for one issue.
 *
 * @returns {{from: string, to: string, count: number}[]}
 */
function summarizeHandoffs(workspaceDir, issue) {
  const entries = readEntries(workspaceDir, issue);
  const pairs = new Map();
  for (const e of entries) {
    if (e.from === ANY) continue;
    pairs.set(`${e.from} -> ${e.to}`, { from: e.from, to: e.to });
  }
  return [...pairs.values()].map((p) => ({ ...p, count: repeatsSinceReset(entries, p.from, p.to).length }));
}

module.exports = {
  handoffDir,
  issueKey,
  logPath,
  normalizeAgent,
  readEntries,
  checkHandoff,
  recordHandoff,
  resetHandoffs,
  summarizeHandoffs,
};
