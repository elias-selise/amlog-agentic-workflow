#!/usr/bin/env node
'use strict';

// build-e2e-report.js — turn a Playwright JSON report (or Cypress/JUnit XML) into the standard
// QA report (.amlog/qa/e2e-report.json, schema in the qa-scope skill).
//
//   --format playwright|junit   --input <file>   --exit <n>
//   --issue --depth --started --out --notes "text" --force-status no-tests (when nothing could run)

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const rel = (p) => (p && path.isAbsolute(p) ? path.relative(process.cwd(), p) : p);

const totals = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
const failures = [];
const flakyTests = [];
const artifacts = [];

function categorise(text) {
  if (/axe|a11y|accessib|aria-|color-contrast/i.test(text)) return 'accessibility';
  if (/console\s*(error|message)|pageerror|uncaught|unhandled/i.test(text)) return 'console-error';
  if (/toHaveScreenshot|screenshot|snapshot|pixel/i.test(text)) return 'visual';
  if (/ECONNREFUSED|net::ERR|ENOTFOUND|webServer|browserType\.launch|Executable doesn't exist/i.test(text)) return 'environment';
  if (/validation|required field|invalid/i.test(text)) return 'validation';
  return 'functional';
}

const entry = (id, title, message, detail, evidence) => ({
  id,
  title,
  category: categorise(`${title} ${message}`),
  ac: (/AC-?\d+/i.exec(title) || [null])[0],
  message: stripAnsi(message).split('\n').find((l) => l.trim()) || 'test failed',
  detail: stripAnsi(detail).slice(0, 4000),
  evidence: [...new Set(evidence.filter(Boolean).map(rel))],
});

function fromPlaywright(file) {
  let json;
  try { json = JSON.parse(read(file)); } catch { return false; }

  const walk = (suite, titles, parentFile) => {
    const file = suite.file || parentFile || '';
    const here = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        totals.total += 1;
        const name = [...here, spec.title].join(' › ');
        const id = `${file}:${name}${t.projectName ? ` [${t.projectName}]` : ''}`;
        if (t.status === 'skipped') { totals.skipped += 1; continue; }
        if (t.status === 'expected') { totals.passed += 1; continue; }
        const results = t.results || [];
        const last = results[results.length - 1] || {};
        const err = last.error || (last.errors || [])[0] || {};
        const evidence = results.flatMap((r) => (r.attachments || []).map((a) => a.path));
        evidence.forEach((p) => p && artifacts.push(rel(p)));
        if (t.status === 'flaky') {
          totals.flaky += 1;
          totals.passed += 1;
          const first = results.find((r) => r.status !== 'passed') || {};
          const e = first.error || {};
          flakyTests.push(entry(id, name, e.message || 'passed only on retry', e.stack || e.message || '', evidence));
        } else {
          totals.failed += 1;
          failures.push(entry(id, name, err.message || 'test failed', err.stack || err.message || '', evidence));
        }
      }
    }
    for (const child of suite.suites || []) walk(child, here, file);
  };
  for (const s of json.suites || []) walk(s, []);
  artifacts.push(rel(file));
  return true;
}

function fromJunit(file) {
  const xml = read(file);
  if (!xml) return false;
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xml))) {
    totals.total += 1;
    const attr = (n) => unescapeXml((new RegExp(`${n}="([^"]*)"`).exec(m[1]) || [])[1] || '');
    const name = [attr('classname'), attr('name')].filter(Boolean).join(' › ');
    const body = m[3] || '';
    if (/<skipped/.test(body)) { totals.skipped += 1; continue; }
    const f = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(body);
    if (!f) { totals.passed += 1; continue; }
    totals.failed += 1;
    const msg = unescapeXml((/message="([^"]*)"/.exec(f[2] || f[5] || '') || [])[1] || '');
    failures.push(entry(name, name, msg, unescapeXml(f[3] || msg), []));
  }
  artifacts.push(rel(file));
  return true;
}

const format = opt('format', 'playwright');
const input = opt('input');
const parsed = input ? (format === 'junit' ? fromJunit(input) : fromPlaywright(input)) : false;

const exitCode = Number(opt('exit', '0'));
const reasons = [];
let status;
if (opt('force-status')) {
  status = opt('force-status');
} else if (!parsed) {
  status = 'error';
  reasons.push('the test runner produced no readable results — the app or browser likely failed to start');
} else if (failures.length) {
  status = 'fail';
} else if (totals.total === 0) {
  status = 'no-tests';
  reasons.push('the E2E suite ran but contains no tests — write journeys for this change');
} else if (exitCode !== 0) {
  status = 'error';
  reasons.push('the runner exited non-zero but no failed test was recorded — check the runner output');
} else {
  status = totals.flaky ? 'flaky' : 'pass';
}
if (flakyTests.length) reasons.push(`${flakyTests.length} test(s) passed only on retry`);
if (opt('notes')) reasons.push(opt('notes'));

const started = opt('started', new Date().toISOString());
const report = {
  agent: 'e2e-tester-amlog',
  issue: opt('issue', ''),
  status,
  reason: reasons.join('; '),
  depth: opt('depth', 'full'),
  startedAt: started,
  durationMs: Math.max(0, Date.now() - Date.parse(started)),
  model: process.env.AMLOG_MODEL || '',
  totals,
  failures,
  flakyTests,
  artifacts: [...new Set(artifacts)],
};

const out = opt('out', '.amlog/qa/e2e-report.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status, totals, failures: failures.length, out }) + '\n');
