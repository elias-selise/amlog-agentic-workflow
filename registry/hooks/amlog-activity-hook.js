#!/usr/bin/env node
'use strict';

// amlog activity capture hook.
//
// Registered as a Claude Code `PostToolUse` hook on Read|Write|Edit|MultiEdit|
// NotebookEdit. Claude Code pipes one JSON object on stdin per tool call; this
// script appends one NDJSON line per file touch to `.amlog/activity/events.ndjson`
// so the VS Code extension (the "spider crawler") can tail it live.
//
// Hard rule: this must NEVER break the agent's tool call. Every path is wrapped
// so the process always exits 0, even on malformed input or an unwritable disk.
//
// Dependency-free on purpose: it runs from the user's workspace (`node
// .amlog/hooks/amlog-activity-hook.js`), where amlog's own node_modules are not
// guaranteed to be resolvable. Node's built-in `fs`/`path` only.

const fs = require('fs');
const path = require('path');

// Start a fresh events file once the current one passes this size, keeping a
// single `.1` backup, so a long-running workspace never grows the log without
// bound. `.amlog/` is gitignored, so rotation is invisible to version control.
const MAX_BYTES = 5 * 1024 * 1024;

// Tool name -> coarse operation. Anything that changes a file is a "write".
const OP_BY_TOOL = {
  Read: 'read',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
};

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(data); } };
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', done);
      process.stdin.on('error', done);
      // Never hang the tool call waiting on stdin that never closes.
      setTimeout(done, 2000).unref();
    } catch {
      done();
    }
  });
}

// Pull the first string field present from a list of candidate keys.
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

function rotateIfNeeded(file) {
  try {
    const { size } = fs.statSync(file);
    if (size >= MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // No file yet (ENOENT) or stat failed — nothing to rotate.
  }
}

async function main() {
  const raw = await readStdin();

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // Malformed payload — swallow, never throw.
  }
  if (!input || typeof input !== 'object') return;

  const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
  const op = OP_BY_TOOL[toolName];
  if (!op) return; // Not a file tool we track (defensive; matcher already filters).

  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const filePath = pick(toolInput, ['file_path', 'notebook_path', 'path']);
  if (!filePath) return; // Nothing to point the spider at.

  // Root the workspace on the hook's reported cwd (Claude Code sets this to the
  // project dir); fall back to the process cwd.
  const workspaceDir = (typeof input.cwd === 'string' && input.cwd) || process.cwd();

  let relFile = filePath;
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceDir, filePath);
    relFile = path.relative(workspaceDir, abs) || path.basename(abs);
  } catch {
    // Keep the raw path if resolution fails.
  }
  relFile = relFile.split(path.sep).join('/'); // Stable, POSIX-style for the UI.

  // `agent_type` / `agent_id` are present only when the tool ran inside a
  // subagent. The main session reports neither, so it is labelled "main".
  const agent = pick(input, ['agent_type']) || 'main';
  const agentId = pick(input, ['agent_id']) || '';

  const event = {
    ts: new Date().toISOString(),
    op,
    file: relFile,
    agent,
    agentId,
    tool: toolName,
    session: pick(input, ['session_id']) || '',
    toolUseId: pick(input, ['tool_use_id']) || '',
  };

  try {
    const activityDir = path.join(workspaceDir, '.amlog', 'activity');
    fs.mkdirSync(activityDir, { recursive: true });
    const file = path.join(activityDir, 'events.ndjson');
    rotateIfNeeded(file);
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Disk full, permission denied, race on mkdir — stay silent.
  }
}

main().catch(() => {}).finally(() => process.exit(0));
