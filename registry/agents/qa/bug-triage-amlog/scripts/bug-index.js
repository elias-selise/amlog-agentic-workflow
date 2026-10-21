#!/usr/bin/env node
'use strict';

// bug-index.js — local bug ledger for bug-triage-amlog (.amlog/qa/bugs.json).
//
//   ingest   --report <file> [--issue N]   fingerprint every failure in a QA report, mark each
//                                          new | known | regressed, and mark open bugs that
//                                          no longer fail as verified-fixed
//   verify   --report <file> [--issue N]  only mark open bugs that no longer fail as verified-fixed
//                                          (what test-executor-amlog runs after a re-run; never creates bugs)
//   link     --id BUG-3 --url <url>        record the GitHub issue a bug was filed as
//   set      --id BUG-3 --field severity --value S2   (fields: severity, category, owner, title)
//   resolve  --id BUG-3 [--note "..."]     close a bug by hand (e.g. won't fix / duplicate)
//   list     [--issue N] [--state open]    print the ledger as JSON
//
// A bug's identity is its fingerprint: same failing check + same normalised error = same bug,
// no matter which run or which line number the error came from. All output is JSON on stdout.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEDGER = path.join(process.cwd(), '.amlog', 'qa', 'bugs.json');
const OPEN = new Set(['open', 'regressed']);

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

function load() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return { nextId: 1, bugs: [] }; }
}
function save(ledger) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
}
function out(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
function fail(msg) { process.stderr.write(`bug-index: ${msg}\n`); process.exit(1); }

// Strip everything that varies run-to-run so the same defect always hashes the same.
function normalise(text) {
  return String(text || '')
    .split('\n')[0]
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<guid>')
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '<time>')
    .replace(/(?:[a-z]:)?(?:[\\/][\w.@-]+)+[\\/]([\w.@-]+)/g, '$1')   // abs path -> basename
    .replace(/:\d+(:\d+)?/g, '')                                      // :line:col
    .replace(/\b0x[0-9a-f]+\b/g, '<hex>')
    .replace(/\b\d+(\.\d+)?(ms|s|px|%)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint(agent, failure) {
  const key = [agent, failure.category || '', failure.id || failure.title || '', normalise(failure.message)].join('|');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
}

function findById(ledger, id) {
  const bug = ledger.bugs.find((b) => b.id === id);
  if (!bug) fail(`no bug with id ${id}`);
  return bug;
}

// Only a run that actually executed can prove a bug fixed.
function markVerifiedFixed(ledger, report, agent, issue, seen, now) {
  const verified = [];
  if (!['pass', 'fail', 'flaky'].includes(report.status)) return verified;
  for (const bug of ledger.bugs) {
    if (bug.issue === issue && bug.source === agent && OPEN.has(bug.state) && !seen.has(bug.fingerprint)) {
      bug.state = 'verified-fixed';
      bug.verifiedAt = now;
      verified.push({ id: bug.id, title: bug.title, url: bug.url });
    }
  }
  return verified;
}

function loadReport() {
  const file = opt('report');
  if (!file) fail(`${cmd} needs --report <file>`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fail(`cannot read report: ${e.message}`); }
}

function verify() {
  const report = loadReport();
  const issue = String(opt('issue', report.issue || ''));
  const agent = report.agent || path.basename(opt('report'));
  const ledger = load();
  const seen = new Set((report.failures || []).map((f) => fingerprint(agent, f)));
  const verified = markVerifiedFixed(ledger, report, agent, issue, seen, new Date().toISOString());
  save(ledger);
  out({ issue, source: agent, reportStatus: report.status, verifiedFixed: verified });
}

function ingest() {
  const report = loadReport();
  const issue = String(opt('issue', report.issue || ''));
  const agent = report.agent || path.basename(opt('report'));
  const now = new Date().toISOString();
  const ledger = load();
  const seen = new Set();
  const results = [];

  for (const f of report.failures || []) {
    const fp = fingerprint(agent, f);
    seen.add(fp);
    let bug = ledger.bugs.find((b) => b.fingerprint === fp && b.issue === issue);
    let state;
    if (!bug) {
      bug = {
        id: `BUG-${ledger.nextId++}`,
        fingerprint: fp,
        issue,
        source: agent,
        title: f.title || f.id || 'untitled failure',
        category: f.category || 'functional',
        ac: f.ac || null,
        message: f.message || '',
        state: 'open',
        occurrences: 1,
        firstSeen: now,
        lastSeen: now,
        url: null,
      };
      ledger.bugs.push(bug);
      state = 'new';
    } else if (bug.state === 'verified-fixed') {
      bug.state = 'regressed';
      bug.occurrences += 1;
      bug.lastSeen = now;
      bug.regressedAt = now;
      state = 'regressed';
    } else {
      bug.occurrences += 1;
      bug.lastSeen = now;
      state = 'known';
    }
    results.push({ id: bug.id, state, fingerprint: fp, occurrences: bug.occurrences, url: bug.url, title: bug.title });
  }

  const verified = markVerifiedFixed(ledger, report, agent, issue, seen, now);

  save(ledger);
  out({ issue, source: agent, reportStatus: report.status, failures: results, verifiedFixed: verified });
}

function link() {
  const ledger = load();
  const bug = findById(ledger, opt('id'));
  bug.url = opt('url', null);
  save(ledger);
  out(bug);
}

function set() {
  const field = opt('field');
  if (!['severity', 'category', 'owner', 'title'].includes(field)) fail('--field must be severity, category, owner or title');
  const ledger = load();
  const bug = findById(ledger, opt('id'));
  bug[field] = opt('value', '');
  save(ledger);
  out(bug);
}

function resolve() {
  const ledger = load();
  const bug = findById(ledger, opt('id'));
  bug.state = 'closed';
  bug.closedAt = new Date().toISOString();
  bug.note = opt('note', '');
  save(ledger);
  out(bug);
}

function list() {
  const ledger = load();
  const issue = opt('issue');
  const state = opt('state');
  out(ledger.bugs.filter((b) => (!issue || b.issue === String(issue)) && (!state || b.state === state)));
}

const commands = { ingest, verify, link, set, resolve, list };
if (!commands[cmd]) fail(`usage: bug-index.js <${Object.keys(commands).join('|')}> [options]`);
commands[cmd]();
