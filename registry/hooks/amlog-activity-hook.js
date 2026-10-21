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

// Tool name -> coarse operation. Writes change a file; reads inspect one; search
// looks across files (Grep/Glob); bash runs a shell command (path approximate).
const OP_BY_TOOL = {
  Read: 'read',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
  Grep: 'search',
  Glob: 'search',
  Bash: 'bash',
};

// Only search inside a file (to locate an Edit's line) when it is small enough
// that reading it can't slow the tool call down noticeably.
const MAX_LOCATE_BYTES = 1024 * 1024;

function countLines(text) {
  if (typeof text !== 'string' || text === '') return 0;
  return text.split(/\r?\n/).length;
}

function truncate(text, max) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// 1-based line number where `needle` first appears in the file at `absPath`,
// or undefined if the file is unreadable / too big / the text isn't found.
// Best-effort and fully guarded — never throws.
function locateLine(absPath, needle) {
  if (typeof needle !== 'string' || !needle) return undefined;
  try {
    if (fs.statSync(absPath).size > MAX_LOCATE_BYTES) return undefined;
    const text = fs.readFileSync(absPath, 'utf8');
    const idx = text.indexOf(needle.split(/\r?\n/)[0]);
    if (idx < 0) return undefined;
    return text.slice(0, idx).split(/\r?\n/).length;
  } catch {
    return undefined;
  }
}

// Derive the line range / size of a tool call from its input — the same facts
// the terminal shows ("read lines 1-200", "wrote 40 lines", "edited 5 lines").
// Returns { startLine?, endLine?, lines?, detail }. Always safe.
function describeRange(toolName, toolInput, absPath) {
  try {
    if (toolName === 'Read') {
      const offset = Number(toolInput.offset);
      const limit = Number(toolInput.limit);
      const startLine = Number.isFinite(offset) && offset > 0 ? offset : 1;
      if (Number.isFinite(limit) && limit > 0) {
        const endLine = startLine + limit - 1;
        const detail = startLine > 1 ? `read lines ${startLine}-${endLine}` : `read first ${limit} lines`;
        return { startLine, endLine, lines: limit, detail };
      }
      return { startLine, detail: startLine > 1 ? `read from line ${startLine}` : 'read whole file' };
    }

    if (toolName === 'Write') {
      const lines = countLines(toolInput.content);
      return { startLine: 1, endLine: lines || undefined, lines, detail: `wrote ${lines} line(s)` };
    }

    if (toolName === 'Edit') {
      const lines = countLines(toolInput.new_string);
      const startLine = locateLine(absPath, toolInput.new_string) || locateLine(absPath, toolInput.old_string);
      const endLine = startLine && lines ? startLine + lines - 1 : undefined;
      const where = startLine ? ` @ line ${startLine}` : '';
      return { startLine, endLine, lines, detail: `edited ${lines} line(s)${where}` };
    }

    if (toolName === 'MultiEdit') {
      const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
      const lines = edits.reduce((n, e) => n + countLines(e && e.new_string), 0);
      const startLine = edits.length ? locateLine(absPath, edits[0].new_string) : undefined;
      const endLine = startLine && lines ? startLine + lines - 1 : undefined;
      return { startLine, endLine, lines, detail: `${edits.length} edit(s), ${lines} line(s)` };
    }

    if (toolName === 'NotebookEdit') {
      const mode = typeof toolInput.edit_mode === 'string' ? toolInput.edit_mode : 'edit';
      const cell = toolInput.cell_id ? ` cell ${toolInput.cell_id}` : '';
      return { detail: `notebook ${mode}${cell}` };
    }

    if (toolName === 'Grep') {
      const pat = truncate(toolInput.pattern, 40);
      const where = toolInput.glob ? ` in ${truncate(toolInput.glob, 20)}` : '';
      return { detail: `grep "${pat}"${where}` };
    }

    if (toolName === 'Glob') {
      return { detail: `glob ${truncate(toolInput.pattern, 50)}` };
    }

    if (toolName === 'Bash') {
      const desc = typeof toolInput.description === 'string' && toolInput.description
        ? toolInput.description
        : truncate(toolInput.command, 60);
      return { detail: `$ ${desc}` };
    }
  } catch {
    // fall through to the empty descriptor
  }
  return { detail: '' };
}

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

  // Root the workspace on the hook's reported cwd (Claude Code sets this to the
  // project dir); fall back to the process cwd.
  const workspaceDir = (typeof input.cwd === 'string' && input.cwd) || process.cwd();

  // What the tool is pointed at. read/write need a concrete file; search points
  // at a path (often a directory, defaulting to the workspace); bash has no path.
  let rawPath;
  if (op === 'read' || op === 'write') {
    rawPath = pick(toolInput, ['file_path', 'notebook_path']);
    if (!rawPath) return; // Nothing to point the spider at.
  } else if (op === 'search') {
    rawPath = pick(toolInput, ['path']) || '.';
  } else {
    rawPath = null; // bash
  }

  let absPath = rawPath || '';
  let relFile = op === 'bash' ? '(bash)' : rawPath;
  if (rawPath) {
    try {
      absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(workspaceDir, rawPath);
      const rel = path.relative(workspaceDir, absPath);
      relFile = rel === '' ? '.' : rel; // the workspace root reads as "."
    } catch {
      // Keep the raw path if resolution fails.
    }
    relFile = (relFile || '.').split(path.sep).join('/'); // POSIX-style for the UI.
  }

  // `agent_type` / `agent_id` are present only when the tool ran inside a
  // subagent. The main session reports neither, so it is labelled "main".
  const agent = pick(input, ['agent_type']) || 'main';
  const agentId = pick(input, ['agent_id']) || '';

  // Line range / size — the same facts the terminal prints for each tool call.
  const range = describeRange(toolName, toolInput, absPath);

  const event = {
    ts: new Date().toISOString(),
    op,
    file: relFile,
    agent,
    agentId,
    tool: toolName,
    startLine: range.startLine,
    endLine: range.endLine,
    lines: range.lines,
    detail: range.detail,
    session: pick(input, ['session_id']) || '',
    toolUseId: pick(input, ['tool_use_id']) || '',
    // Lets the extension find and tail the full session transcript (its
    // primary source); these hook events are then only a fallback.
    transcript: pick(input, ['transcript_path']) || undefined,
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
