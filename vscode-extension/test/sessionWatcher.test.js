const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assistant, text, toolUse, result } = require('./helpers.js');

// Point Claude's config dir at a temp folder before the watcher resolves it.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'amlog-watch-'));
process.env.CLAUDE_CONFIG_DIR = path.join(base, 'claude');
const { SessionWatcher, projectDirFor } = require('../out/transcript/sessionWatcher.js');

const append = (file, recs) => fs.appendFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
async function until(cond, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail('timed out waiting for the watcher');
}
const read = (id, file, extra = {}) => [
  assistant([toolUse(id, 'Read', { file_path: file })]),
  result(id, 'x', { type: 'text', file: { filePath: file, startLine: 1, numLines: 5, totalLines: 5 } }, extra),
];

test('tails main + subagent transcripts, flags backlog vs live, writes the trace file', async () => {
  const ws = path.join(base, 'ws');
  fs.mkdirSync(path.join(ws, 'docs', '2793'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'docs', '2793', 'instructions.md'), '# story\n');
  const pd = projectDirFor(ws);
  fs.mkdirSync(pd, { recursive: true });
  const main = path.join(pd, 'sess-1.jsonl');

  // history from before the extension started
  const old = [{ type: 'ai-title', aiTitle: 'Issue 2793' }, ...read('t1', path.join(ws, 'docs/2793/instructions.md'))];
  fs.writeFileSync(main, old.map((r) => JSON.stringify({ ...r, timestamp: '2020-01-01T00:00:00.000Z' })).join('\n') + '\n');

  const got = [];
  const written = [];
  const errors = [];
  const w = new SessionWatcher({
    root: ws,
    lookbackMs: 3600e3,
    pollMs: 40,
    writeTraces: true,
    traceFallbackDir: path.join(ws, '.amlog', 'traces'),
    onEvent: (e, live) => got.push({ ...e, live }),
    onTraceWritten: (f) => written.push(f),
    onError: (m) => errors.push(m),
  });
  try {
    await until(() => got.length === 1);
    assert.equal(got[0].live, false, 'history is replayed quietly');
    assert.ok(w.isTracked('sess-1'));

    // live: a search, then a read of one of its hits; a half-written line must wait
    const grep = [
      assistant([text('Find the mapping. My token: ghp_abcdefghijklmnopqrstuvwxyz0123456789'), toolUse('t2', 'Bash', { command: `cd ${ws} && grep -rn "finish_to_start" src` })]),
      result('t2', '', { stdout: 'src/gantt.ts:130:finish_to_start\n' }),
    ];
    append(main, grep.slice(0, 1));
    const half = JSON.stringify(grep[1]);
    fs.appendFileSync(main, half.slice(0, 20));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(got.length, 1, 'an incomplete line is held back');
    fs.appendFileSync(main, half.slice(20) + '\n');
    append(main, read('t3', path.join(ws, 'src/gantt.ts')));
    await until(() => got.length === 3);
    assert.deepEqual(got.slice(1).map((e) => [e.op, e.live]), [['search', true], ['read', true]]);
    assert.equal(got[1].hitCount, 1);

    // a subagent, with its meta file arriving just after the transcript
    const sd = path.join(pd, 'sess-1', 'subagents');
    fs.mkdirSync(sd, { recursive: true });
    append(path.join(sd, 'agent-abc.jsonl'), [
      assistant([toolUse('s1', 'Write', { file_path: path.join(ws, 'docs/2793/plan.md'), content: '# plan' })]),
      result('s1', 'ok', { type: 'create', filePath: path.join(ws, 'docs/2793/plan.md') }),
    ]);
    fs.writeFileSync(path.join(sd, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'planner-amlog-fe', description: 'Plan #2793' }));
    await until(() => got.length === 4);
    assert.equal(got[3].agent, 'planner-amlog-fe');
    assert.equal(got[3].agentId, 'abc');
    assert.equal(got[3].live, true);

    // a malformed record in the middle never stops the tail
    fs.appendFileSync(main, '{"type":"assistant","message":{"content":[{"type":"tool_use"\n');
    append(main, read('t4', path.join(ws, 'src/other.ts')));
    await until(() => got.length === 5);
    assert.equal(errors.length, 0);
  } finally {
    w.dispose(); // flushes the trace
  }

  const traceFile = path.join(ws, 'docs', '2793', 'agent-trace.json');
  assert.ok(written.includes(traceFile));
  const doc = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
  const s = doc.sessions['sess-1'];
  assert.equal(doc.issue, '2793');
  assert.equal(s.title, 'Issue 2793');
  assert.deepEqual(s.agents.map((a) => a.key).sort(), ['main', 'planner-amlog-fe:abc']);
  assert.equal(s.agents.find((a) => a.key === 'planner-amlog-fe:abc').description, 'Plan #2793');
  assert.equal(s.steps.length, 5);
  assert.ok(!JSON.stringify(doc).includes('ghp_abcdef'), 'secrets never reach the shared file');
  assert.equal(s.redactions, 1);
  assert.ok(Object.keys(s.metrics.tokens).length > 0);
});

test('addTranscript follows a transcript outside the workspace project folder', async () => {
  const ws = path.join(base, 'ws2');
  fs.mkdirSync(ws, { recursive: true });
  const elsewhere = path.join(base, 'elsewhere');
  fs.mkdirSync(elsewhere, { recursive: true });
  const file = path.join(elsewhere, 'sess-9.jsonl');
  const got = [];
  const w = new SessionWatcher({ root: ws, lookbackMs: 0, pollMs: 40, writeTraces: false, onEvent: (e) => got.push(e) });
  try {
    assert.equal(w.isTracked('sess-9'), false);
    append(file, read('t1', path.join(ws, 'a.ts')));
    w.addTranscript(file);
    await until(() => got.length === 1);
    assert.ok(w.isTracked('sess-9'));
    append(file, read('t2', path.join(ws, 'b.ts')));
    await until(() => got.length === 2);
    w.addTranscript(path.join(elsewhere, 'not-a-transcript.txt')); // ignored
  } finally {
    w.dispose();
  }
});

test('old sessions outside the lookback window are not replayed', async () => {
  const ws = path.join(base, 'ws3');
  fs.mkdirSync(ws, { recursive: true });
  const pd = projectDirFor(ws);
  fs.mkdirSync(pd, { recursive: true });
  const file = path.join(pd, 'ancient.jsonl');
  append(file, read('t1', path.join(ws, 'a.ts')));
  const longAgo = new Date(Date.now() - 3 * 3600e3);
  fs.utimesSync(file, longAgo, longAgo);
  const got = [];
  const w = new SessionWatcher({ root: ws, lookbackMs: 3600e3, pollMs: 40, writeTraces: false, onEvent: (e) => got.push(e) });
  try {
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(got.length, 0);
    assert.equal(w.isTracked('ancient'), false);
  } finally {
    w.dispose();
  }
});
