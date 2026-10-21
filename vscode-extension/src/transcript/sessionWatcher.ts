import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActivityEvent } from '../types';
import { ClaudeTranscriptParser } from './claudeTranscript';
import { SessionTrace, writeTrace } from './traceStore';

// Finds and tails Claude Code session transcripts for the workspace:
//   <claude config>/projects/<encoded workspace path>/<session>.jsonl
//   <claude config>/projects/<encoded workspace path>/<session>/subagents/agent-<id>.jsonl (+ .meta.json)
// plus any transcript path the activity hook reports (sessions started from a
// different directory, e.g. a worktree).
//
// Polling, not fs.watch: a handful of stat/read calls per tick is cheap, works
// the same on every platform, and survives files appearing in new directories.

export interface WatcherOptions {
  root: string; // workspace folder
  lookbackMs: number; // replay sessions active within this window at startup
  pollMs: number;
  traceFallbackDir?: string; // where traces go when no docs/<issue>/ is found
  writeTraces: boolean;
  onEvent: (event: ActivityEvent, live: boolean) => void;
  onTraceWritten?: (file: string) => void;
  onError?: (message: string) => void;
}

interface Tail {
  file: string;
  session: string;
  agent: string; // 'main' or the subagent's type
  agentId: string; // '' for the main session
  parser: ClaudeTranscriptParser;
  offset: number;
  partial: string;
  drainedOnce: boolean;
}

// Skip replaying a backlog bigger than this; follow the file from its end.
const MAX_BACKLOG_BYTES = 64 * 1024 * 1024;
const TRACE_FLUSH_MS = 3000;

export function claudeProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

// Claude Code names a project's transcript folder after its path with every
// non-alphanumeric character replaced by '-'.
export function projectDirFor(root: string): string {
  return path.join(claudeProjectsDir(), root.replace(/[^A-Za-z0-9]/g, '-'));
}

export class SessionWatcher {
  readonly traces = new Map<string, SessionTrace>();
  private readonly dirs = new Set<string>();
  private readonly tails = new Map<string, Tail>();
  private readonly sessions = new Set<string>(); // sessions whose main transcript is tailed
  private readonly startedAt = Date.now();
  private readonly lastWritten = new Map<string, string>();
  private readonly pollTimer: ReturnType<typeof setInterval>;
  private readonly flushTimer: ReturnType<typeof setInterval>;

  constructor(private readonly opts: WatcherOptions) {
    this.dirs.add(projectDirFor(opts.root));
    this.scan();
    this.pollTimer = setInterval(() => this.scan(), opts.pollMs);
    this.flushTimer = setInterval(() => this.flush(), TRACE_FLUSH_MS);
  }

  isTracked(session: string): boolean {
    return this.sessions.has(session);
  }

  // A transcript path reported by the hook (may live outside the workspace's
  // own project folder). Track it right away.
  addTranscript(file: string): void {
    if (!file.endsWith('.jsonl')) {
      return;
    }
    this.dirs.add(path.dirname(file));
    if (!this.tails.has(file) && exists(file)) {
      this.trackMain(file);
      this.drain(this.tails.get(file) as Tail);
    }
  }

  // Run a scan now (e.g. before deciding a hook event is a duplicate).
  refresh(): void {
    this.scan();
  }

  private scan(): void {
    const cutoff = this.startedAt - this.opts.lookbackMs;
    for (const dir of this.dirs) {
      for (const name of list(dir)) {
        if (!name.endsWith('.jsonl')) {
          continue;
        }
        const file = path.join(dir, name);
        if (!this.tails.has(file)) {
          const st = stat(file);
          if (!st || st.mtimeMs < cutoff) {
            continue;
          }
          this.trackMain(file);
        }
        this.scanSubagents(dir, name.slice(0, -'.jsonl'.length));
      }
    }
    for (const tail of this.tails.values()) {
      this.drain(tail);
    }
  }

  private trackMain(file: string): void {
    const session = path.basename(file, '.jsonl');
    this.sessions.add(session);
    this.tails.set(file, this.newTail(file, session, 'main', ''));
  }

  private scanSubagents(dir: string, session: string): void {
    const subDir = path.join(dir, session, 'subagents');
    for (const name of list(subDir)) {
      const m = /^agent-(.+)\.jsonl$/.exec(name);
      const file = path.join(subDir, name);
      if (!m || this.tails.has(file)) {
        continue;
      }
      const metaFile = path.join(subDir, `agent-${m[1]}.meta.json`);
      const meta = readJson(metaFile);
      // The meta file lands just after the transcript; wait briefly for it so
      // the first events are labelled with the agent's type.
      if (!meta && Date.now() - (stat(file)?.mtimeMs ?? 0) < 3000) {
        continue;
      }
      const type = (meta && typeof meta.agentType === 'string' && meta.agentType) || 'subagent';
      this.tails.set(file, this.newTail(file, session, type, m[1]));
      if (meta && typeof meta.description === 'string') {
        this.trace(session).describeAgent(type, m[1], meta.description);
      }
    }
  }

  private newTail(file: string, session: string, agent: string, agentId: string): Tail {
    const size = stat(file)?.size ?? 0;
    return {
      file,
      session,
      agent,
      agentId,
      parser: new ClaudeTranscriptParser(this.opts.root, session, agent, agentId),
      offset: size > MAX_BACKLOG_BYTES ? size : 0,
      partial: '',
      drainedOnce: false,
    };
  }

  private trace(session: string): SessionTrace {
    let t = this.traces.get(session);
    if (!t) {
      t = new SessionTrace(session);
      this.traces.set(session, t);
    }
    return t;
  }

  private drain(tail: Tail): void {
    const st = stat(tail.file);
    if (!st) {
      return;
    }
    if (st.size < tail.offset) {
      tail.offset = 0; // rewritten / truncated
      tail.partial = '';
    }
    if (st.size === tail.offset) {
      tail.drainedOnce = true;
      return;
    }
    let chunk: string;
    try {
      const fd = fs.openSync(tail.file, 'r');
      try {
        const length = st.size - tail.offset;
        const buf = Buffer.alloc(length);
        const read = fs.readSync(fd, buf, 0, length, tail.offset);
        chunk = buf.toString('utf8', 0, read);
        tail.offset += read;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }

    const lines = (tail.partial + chunk).split('\n');
    tail.partial = lines.pop() ?? ''; // an in-flight append; finish it next time
    const trace = this.trace(tail.session);
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let rec: unknown;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      let parsed;
      try {
        parsed = tail.parser.feed(rec);
      } catch (err) {
        this.opts.onError?.(`AMLOG: could not read a transcript record (${String(err)})`);
        continue;
      }
      if (!parsed) {
        continue;
      }
      for (const meta of parsed.meta) {
        trace.addMeta(meta);
      }
      if (parsed.usage) {
        trace.addUsage(tail.agent, tail.agentId, parsed.usage, parsed.ts);
      }
      for (const ev of parsed.events) {
        trace.addEvent(ev);
        // Backlog replays quietly; anything that happened after the extension
        // started (or arrives in a later read) is live.
        const live = tail.drainedOnce || Date.parse(ev.ts) >= this.startedAt;
        this.opts.onEvent(ev, live);
      }
    }
    tail.drainedOnce = true;
  }

  private flush(): void {
    if (!this.opts.writeTraces) {
      return;
    }
    for (const trace of this.traces.values()) {
      if (!trace.dirty) {
        continue;
      }
      trace.dirty = false;
      try {
        const file = writeTrace(trace, this.opts.traceFallbackDir, this.lastWritten);
        if (file) {
          this.opts.onTraceWritten?.(file);
        }
      } catch (err) {
        this.opts.onError?.(`AMLOG: could not write the agent trace (${String(err)})`);
      }
    }
  }

  dispose(): void {
    clearInterval(this.pollTimer);
    clearInterval(this.flushTimer);
    this.flush();
  }
}

function list(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function stat(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file);
  } catch {
    return undefined;
  }
}

function exists(file: string): boolean {
  return !!stat(file);
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}
