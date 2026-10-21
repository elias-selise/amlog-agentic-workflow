#!/usr/bin/env node
'use strict';

// build-contract-report.js — turn the raw outputs of run-contract-tests.sh into the standard
// QA report (.amlog/qa/api-contract-report.json, schema in the qa-scope skill).
//
//   --trx <file>            dotnet test results (TRX)
//   --exit <n>              exit code of the dotnet test run
//   --breaking <file>       oasdiff output (non-empty + --breaking-exit != 0 => breaking change)
//   --breaking-exit <n>
//   --fuzz <log>            schemathesis output
//   --fuzz-exit <n>
//   --retry-passed          the failed run passed on retry => status "flaky"
//   --notes "text"          extra context appended to `reason`
//   --issue --depth --started --out

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const failures = [];
const totals = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
const artifacts = [];
const reasons = [];

// --- dotnet test (TRX) -------------------------------------------------------------------
const trxFile = opt('trx');
const trx = trxFile ? read(trxFile) : '';
if (trx) {
  artifacts.push(trxFile);
  const counters = /<Counters\b([^>]*)\/>/.exec(trx);
  const num = (name) => Number((new RegExp(`${name}="(\\d+)"`).exec(counters ? counters[1] : '') || [])[1] || 0);
  totals.total = num('executed') + num('notExecuted');
  totals.passed = num('passed');
  totals.failed = num('failed');
  totals.skipped = num('notExecuted');

  const resultRe = /<UnitTestResult\b([^>]*)>([\s\S]*?)<\/UnitTestResult>/g;
  let m;
  while ((m = resultRe.exec(trx))) {
    if (!/outcome="Failed"/.test(m[1])) continue;
    const name = unescapeXml((/testName="([^"]*)"/.exec(m[1]) || [])[1] || 'unknown test');
    const message = unescapeXml(((/<Message>([\s\S]*?)<\/Message>/.exec(m[2]) || [])[1] || '').trim());
    const stack = unescapeXml(((/<StackTrace>([\s\S]*?)<\/StackTrace>/.exec(m[2]) || [])[1] || '').trim());
    const text = `${name} ${message}`;
    failures.push({
      id: name,
      title: name.split('.').slice(-2).join('.'),
      category: /401|403|unauthori[sz]ed|forbidden|auth/i.test(text) ? 'auth'
        : /400|validation|problemdetails|badrequest/i.test(text) ? 'validation'
        : /schema|contract|property|required|nullable|json/i.test(text) ? 'contract'
        : 'functional',
      ac: (/AC-?\d+/i.exec(text) || [null])[0],
      message: message.split('\n')[0] || 'test failed',
      detail: [message, stack].filter(Boolean).join('\n'),
      evidence: [trxFile],
    });
  }
}

// --- breaking changes vs the base branch's OpenAPI spec -----------------------------------
const breakingFile = opt('breaking');
const breaking = breakingFile ? read(breakingFile).trim() : '';
if (breaking && Number(opt('breaking-exit', '0')) !== 0) {
  artifacts.push(breakingFile);
  failures.push({
    id: 'openapi-breaking-change',
    title: 'OpenAPI contract has breaking changes vs base branch',
    category: 'contract',
    ac: null,
    message: breaking.split('\n')[0],
    detail: breaking,
    evidence: [breakingFile],
  });
}

// --- schema-driven fuzzing ----------------------------------------------------------------
const fuzzLog = opt('fuzz');
if (fuzzLog && Number(opt('fuzz-exit', '0')) !== 0) {
  const log = read(fuzzLog);
  artifacts.push(fuzzLog);
  const hit = log.split('\n').find((l) => /(fail|error|5\d\d|schema)/i.test(l)) || 'schema-driven fuzzing found failures';
  failures.push({
    id: 'schemathesis-fuzz',
    title: 'Schema-driven fuzzing found contract violations',
    category: 'contract',
    ac: null,
    message: hit.trim(),
    detail: log.slice(-4000),
    evidence: [fuzzLog],
  });
}

// --- status -------------------------------------------------------------------------------
const exitCode = Number(opt('exit', '0'));
let status;
if (failures.length) {
  status = flag('retry-passed') ? 'flaky' : 'fail';
  if (status === 'flaky') totals.flaky = failures.length;
} else if (exitCode !== 0 && !trx) {
  status = 'error';
  reasons.push('dotnet test produced no results file — the build or test host failed before any test ran');
} else if (exitCode !== 0) {
  status = 'error';
  reasons.push('dotnet test exited non-zero but no failed test was recorded — check the build output');
} else if (totals.total === 0) {
  status = 'no-tests';
  reasons.push('no tests matched the contract filter — write contract tests for the changed endpoints');
} else {
  status = 'pass';
}
if (opt('notes')) reasons.push(opt('notes'));

const started = opt('started', new Date().toISOString());
const report = {
  agent: 'api-contract-tester-amlog',
  issue: opt('issue', ''),
  status,
  reason: reasons.join('; '),
  depth: opt('depth', 'full'),
  startedAt: started,
  durationMs: Math.max(0, Date.now() - Date.parse(started)),
  model: process.env.AMLOG_MODEL || '',
  totals,
  failures,
  artifacts,
};

const out = opt('out', '.amlog/qa/api-contract-report.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status, totals, failures: failures.length, out }) + '\n');
