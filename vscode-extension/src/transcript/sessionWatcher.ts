import * as fs from 'fs';
import { ActivityEvent } from '../types';
import { RecordParser } from './common';
import { AntigravitySource } from './antigravitySource';
import { ClaudeSource } from './claudeSource';
import { CodexSource } from './codexSource';
import { SessionSource, TailSpec } from './source';
import { SessionTrace, writeTrace } from './traceStore';

// Follows the session logs of every enabled agent (Claude Code, Codex,
// Antigravity) for the workspace. Each source discovers its own log files; this
// class tails them, turns their records into events through the matching parser,
// feeds the trace store, and writes trace files.
//
// Polling, not fs.watch: a handful of stat/read calls per tick is cheap, works
// the same on every platform, and survives files appearing in new directories.

export const ALL_SOURCES = ['claude', 'codex', 'antigravity'] as const;

export interface WatcherOptions {
  root: string; // workspace folder
  lookbackMs: number; // replay sessions active within this window at startup
  pollMs: number;
  sources?: string[]; // which agents to follow (default: all)
  traceFallbackDir?: string; // where traces go when no docs/<issue>/ is found
  writeTraces: boolean;
  onEvent: (event: ActivityEvent, live: boolean) => void;
  onTraceWritten?: (file: string) => void;
  onError?: (message: string) => void;
}

interface Tail extends TailSpec {
  source: string;
  parser: RecordParser;
  offset: number;
  partial: string;
  drainedOnce: boolean;
}

// Skip replaying a backlog bigger than this; follow the file from its end.
const MAX_BACKLOG_BYTES = 64 * 1024 * 1024;
const TRACE_FLUSH_MS = 3000;

export class SessionWatcher {
  readonly traces = new Map<string, SessionTrace>();
  private readonly sources: SessionSource[];
  private readonly claude?: ClaudeSource;
  private readonly lastScan = new Map<string, number>();
  private readonly tails = new Map<string, Tail>();
  private readonly sessions = new Set<string>(); // sessions whose main log is tailed
  private readonly startedAt = Date.now();
  private readonly lastWritten = new Map<string, string>();
  private readonly pollTimer: ReturnType<typeof setInterval>;
  private readonly flushTimer: ReturnType<typeof setInterval>;

  constructor(private readonly opts: WatcherOptions) {
    const want = new Set(opts.sources ?? ALL_SOURCES);
    this.sources = [];
    if (want.has('claude')) {
      this.claude = new ClaudeSource(opts.root);
      this.sources.push(this.claude);
    }
    if (want.has('codex')) {
      this.sources.push(new CodexSource(opts.root));
    }
    if (want.has('antigravity')) {
      this.sources.push(new AntigravitySource(opts.root));
    }
    this.scan();
    this.pollTimer = setInterval(() => this.scan(), opts.pollMs);
    this.flushTimer = setInterval(() => this.flush(), TRACE_FLUSH_MS);
  }

  isTracked(session: string): boolean {
    return this.sessions.has(session);
  }

  // A Claude Code transcript path reported by the hook (may live outside the
  // workspace's own project folder). Follow it right away.
  addTranscript(file: string): void {
    if (this.claude) {
      this.claude.addTranscript(file);
      this.scan();
    }
  }

  // Run a scan now (e.g. before deciding a hook event is a duplicate).
  refresh(): void {
    this.scan();
  }

  private scan(): void {
    const now = Date.now();
    const ctx = {
      root: this.opts.root,
      cutoffMs: this.startedAt - this.opts.lookbackMs,
      now,
      hasTail: (file: string) => this.tails.has(file),
    };
    for (const source of this.sources) {
      if (source.scanEveryMs && now - (this.lastScan.get(source.name) ?? 0) < source.scanEveryMs) {
        continue;
      }
      this.lastScan.set(source.name, now);
      let specs: TailSpec[] = [];
      try {
        specs = source.scan(ctx);
      } catch (err) {
        this.opts.onError?.(`AMLOG: could not scan ${source.name} sessions (${String(err)})`);
      }
      for (const spec of specs) {
        this.track(source.name, spec);
      }
    }
    for (const tail of this.tails.values()) {
      this.drain(tail);
    }
  }

  private track(source: string, spec: TailSpec): void {
    if (this.tails.has(spec.file)) {
      return;
    }
    const size = fs.statSync(spec.file, { throwIfNoEntry: false })?.size ?? 0;
    this.tails.set(spec.file, {
      ...spec,
      source,
      offset: size > MAX_BACKLOG_BYTES ? size : 0,
      partial: '',
      drainedOnce: false,
    });
    const trace = this.trace(spec.session, source);
    if (!spec.agentId) {
      this.sessions.add(spec.session);
    } else if (spec.description) {
      trace.describeAgent(spec.agent, spec.agentId, spec.description);
    }
  }

  private trace(session: string, source: string): SessionTrace {
    let t = this.traces.get(session);
    if (!t) {
      t = new SessionTrace(session);
      t.source = source;
      this.traces.set(session, t);
    }
    return t;
  }

  private drain(tail: Tail): void {
    const st = fs.statSync(tail.file, { throwIfNoEntry: false });
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
    const trace = this.trace(tail.session, tail.source);
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
        this.opts.onError?.(`AMLOG: could not read a ${tail.source} record (${String(err)})`);
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
