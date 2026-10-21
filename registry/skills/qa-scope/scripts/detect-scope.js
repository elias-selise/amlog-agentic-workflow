#!/usr/bin/env node
'use strict';

// detect-scope.js — decide which optional QA testers apply to the current change.
//
//   node detect-scope.js [--base main] [--issue 42] [--force api,e2e] [--no-write]
//
// Looks at what changed (committed vs the merge-base, plus the working tree) under
// the front-end and back-end roots, and writes .amlog/qa/scope.json:
//   run.apiContract  -> back-end code changed        (api-contract-tester-amlog applies)
//   run.e2e          -> front-end code changed       (e2e-tester-amlog applies)
// Each flag carries a human-readable reason, so a skip is always explained.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const workspace = process.cwd();
const base = opt('base', 'main');
const issue = opt('issue', null);
const forced = (opt('force', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

function readConfig() {
  for (const p of ['.amlog/amlog-workflow.config.json', 'amlog-workflow.config.json']) {
    try { return JSON.parse(fs.readFileSync(path.join(workspace, p), 'utf8')); } catch { /* next */ }
  }
  return {};
}

const zones = readConfig().zones || {};
const roots = {
  frontend: path.resolve(workspace, process.env.FRONTEND_ROOT || zones.frontend || '../l3-angular-lim-business'),
  backend: path.resolve(workspace, process.env.BACKEND_ROOT || zones.backend || '../l3-net-lim-service'),
};

function git(cwd, gitArgs) {
  const r = spawnSync('git', gitArgs, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

// Changed files (relative to `root`) in the repo that contains `root`.
function changedFiles(root) {
  if (!fs.existsSync(root)) return null;
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  const toplevel = top.trim();
  const files = new Set();
  const addAll = (out) => (out || '').split('\n').filter(Boolean).forEach((f) => files.add(f));

  let mergeBase = null;
  for (const ref of [base, `origin/${base}`]) {
    const mb = git(root, ['merge-base', ref, 'HEAD']);
    if (mb) { mergeBase = mb.trim(); break; }
  }
  if (mergeBase) addAll(git(root, ['diff', '--name-only', mergeBase, 'HEAD']));
  addAll(git(root, ['diff', '--name-only', 'HEAD']));                    // staged + unstaged
  addAll(git(root, ['ls-files', '--others', '--exclude-standard']));     // untracked

  return [...files]
    .map((f) => path.resolve(toplevel, f))
    .filter((abs) => abs === root || abs.startsWith(root + path.sep))
    .map((abs) => path.relative(root, abs).split(path.sep).join('/'));
}

const IGNORE = /(^|\/)(node_modules|bin|obj|dist|coverage|\.angular|\.git)\//;
const isDocOnly = (f) => /\.(md|txt|png|jpe?g|svg|gif)$/i.test(f);
const API_SURFACE = /(controllers?|endpoints?|dtos?|contracts?|requests?|responses?|validators?|filters?|middleware)\/|openapi|swagger|\.proto$|(^|\/)(program|startup)\.cs$|appsettings.*\.json$/i;
const UI_SURFACE = /\.(html|tsx|jsx|vue|scss|css)$|\.component\.ts$|routing|routes|\.guard\.ts$|\.resolver\.ts$|\.interceptor\.ts$/i;

function summarise(root, surfaceRe) {
  const files = changedFiles(root);
  if (files === null) return { root, found: false, changed: false, surfaceChanged: false, files: [] };
  const relevant = files.filter((f) => !IGNORE.test(f) && !isDocOnly(f));
  return {
    root,
    found: true,
    changed: relevant.length > 0,
    surfaceChanged: relevant.some((f) => surfaceRe.test(f)),
    files: relevant,
  };
}

const backend = summarise(roots.backend, API_SURFACE);
const frontend = summarise(roots.frontend, UI_SURFACE);

function decide(side, label, key, forceKey) {
  if (forced.includes(forceKey)) return { run: true, reason: `forced via --force ${forceKey}` };
  if (!side.found) return { run: false, reason: `${label} root not found (${side.root}) — nothing to test` };
  if (!side.changed) return { run: false, reason: `no ${label} changes in this issue — ${key} not applicable` };
  return { run: true, reason: `${label} changed (${side.files.length} file${side.files.length === 1 ? '' : 's'})` };
}

const api = decide(backend, 'back-end', 'API contract testing', 'api');
const e2e = decide(frontend, 'front-end', 'E2E testing', 'e2e');

const scope = {
  issue,
  base,
  generatedAt: new Date().toISOString(),
  frontend,
  backend,
  run: { apiContract: api.run, e2e: e2e.run },
  depth: {
    apiContract: backend.surfaceChanged ? 'full' : 'smoke',
    e2e: frontend.surfaceChanged ? 'full' : 'smoke',
  },
  reasons: { apiContract: api.reason, e2e: e2e.reason },
};

if (!flag('no-write')) {
  const out = path.join(workspace, '.amlog', 'qa', 'scope.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(scope, null, 2) + '\n');
}
process.stdout.write(JSON.stringify(scope, null, 2) + '\n');
