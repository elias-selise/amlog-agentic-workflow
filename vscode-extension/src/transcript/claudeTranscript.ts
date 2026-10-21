import * as os from 'os';
import * as path from 'path';
import { ActivityEvent, SearchHit } from '../types';
import { attributeHits, parseBash, parseHits } from './bashParse';

// Reads one Claude Code transcript file (the main session `<session>.jsonl` or a
// subagent's `subagents/agent-<id>.jsonl`), record by record, and turns it into
// activity events plus the usage/metadata the trace file needs.
//
// The transcript format is undocumented and changes between Claude Code
// versions, so every field is read defensively and unknown records are skipped.
// No `vscode` import: this runs (and is tested) in plain Node.

export interface UsageSample {
  messageId: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface SpawnInfo {
  toolUseId: string;
  agentType: string;
  description: string;
  agentId?: string;
}

export type TranscriptMeta =
  | { kind: 'title'; title: string }
  | { kind: 'pr'; number: number; url: string; repository: string }
  | { kind: 'cost'; costUSD: number; durationMs: number; linesAdded: number; linesRemoved: number }
  | { kind: 'spawn'; spawn: SpawnInfo }
  | { kind: 'context'; cwd: string; gitBranch: string };

export interface ParsedRecord {
  ts: string;
  events: ActivityEvent[];
  usage?: UsageSample;
  meta: TranscriptMeta[];
}

interface PendingTool {
  name: string;
  input: Record<string, unknown>;
  caption?: string;
}

const MAX_HITS = 50;
const CAPTION_MAX = 220;

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function displayPath(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  if (rel === '') {
    return '.';
  }
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join('/');
  }
  return abs.split(path.sep).join('/');
}

function oneLine(text: string, max: number): string {
  const t = text.replace(/[`*_#>]+/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Lines actually changed in the new file, from a structuredPatch:
// '+' lines are added at the new-file cursor, '-' lines mark a deletion point.
function changedRange(patch: unknown): { start?: number; end?: number; added: number } {
  let start: number | undefined;
  let end: number | undefined;
  let added = 0;
  if (!Array.isArray(patch)) {
    return { added };
  }
  for (const hunk of patch) {
    if (!isObj(hunk) || !Array.isArray(hunk.lines)) {
      continue;
    }
    let cursor = num(hunk.newStart) ?? 1;
    for (const line of hunk.lines) {
      const l = str(line);
      if (l.startsWith('+')) {
        added++;
        start = start === undefined ? cursor : Math.min(start, cursor);
        end = end === undefined ? cursor : Math.max(end, cursor);
        cursor++;
      } else if (l.startsWith('-')) {
        start = start === undefined ? cursor : Math.min(start, cursor);
        end = end === undefined ? cursor : Math.max(end, cursor);
      } else {
        cursor++;
      }
    }
  }
  return { start, end, added };
}

// The agent's own scratch space (temp dirs, Claude's config/memory folder) is
// not code it is working on; it stays out of the views and the trace.
const SCRATCH_ROOTS = [os.tmpdir(), '/tmp', process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')]
  .map((p) => path.resolve(p) + path.sep);

export class ClaudeTranscriptParser {
  private readonly pending = new Map<string, PendingTool>();
  private lastText = '';
  private contextSent = false;

  constructor(
    private readonly root: string, // workspace root, for display paths
    private readonly session: string,
    private readonly agent: string, // 'main' or the subagent's type
    private readonly agentId: string,
  ) {}

  private isNoise(abs: string): boolean {
    if (!abs || abs.startsWith(this.root + path.sep)) {
      return false;
    }
    return SCRATCH_ROOTS.some((r) => abs.startsWith(r));
  }

  feed(rec: unknown): ParsedRecord | null {
    if (!isObj(rec)) {
      return null;
    }
    const ts = str(rec.timestamp) || new Date().toISOString();
    const out: ParsedRecord = { ts, events: [], meta: [] };
    const type = str(rec.type);

    if (!this.contextSent && str(rec.cwd)) {
      this.contextSent = true;
      out.meta.push({ kind: 'context', cwd: str(rec.cwd), gitBranch: str(rec.gitBranch) });
    }

    if (type === 'ai-title' && str(rec.aiTitle)) {
      out.meta.push({ kind: 'title', title: str(rec.aiTitle) });
    } else if (type === 'pr-link' && num(rec.prNumber) !== undefined) {
      out.meta.push({ kind: 'pr', number: num(rec.prNumber) as number, url: str(rec.prUrl), repository: str(rec.prRepository) });
    } else if (type === 'cost-state') {
      out.meta.push({
        kind: 'cost',
        costUSD: num(rec.totalCostUSD) ?? 0,
        durationMs: num(rec.totalDuration) ?? 0,
        linesAdded: num(rec.totalLinesAdded) ?? 0,
        linesRemoved: num(rec.totalLinesRemoved) ?? 0,
      });
    } else if (type === 'assistant') {
      this.onAssistant(rec, out);
    } else if (type === 'user') {
      this.onUser(rec, out, ts);
    }
    return out;
  }

  private onAssistant(rec: Rec, out: ParsedRecord): void {
    const msg = rec.message;
    if (!isObj(msg)) {
      return;
    }
    const usage = msg.usage;
    const model = str(msg.model);
    if (isObj(usage) && model && !model.startsWith('<')) {
      out.usage = {
        messageId: str(msg.id) || str(rec.uuid),
        model,
        input: num(usage.input_tokens) ?? 0,
        output: num(usage.output_tokens) ?? 0,
        cacheRead: num(usage.cache_read_input_tokens) ?? 0,
        cacheCreate: num(usage.cache_creation_input_tokens) ?? 0,
      };
    }
    if (!Array.isArray(msg.content)) {
      return;
    }
    for (const block of msg.content) {
      if (!isObj(block)) {
        continue;
      }
      if (block.type === 'text' && str(block.text).trim()) {
        this.lastText = oneLine(str(block.text), CAPTION_MAX);
      } else if (block.type === 'tool_use' && str(block.id)) {
        // The agent's last words before a tool call are its "why" for it.
        this.pending.set(str(block.id), {
          name: str(block.name),
          input: isObj(block.input) ? block.input : {},
          caption: this.lastText || undefined,
        });
        this.lastText = '';
      }
    }
  }

  private onUser(rec: Rec, out: ParsedRecord, ts: string): void {
    const msg = rec.message;
    if (!isObj(msg) || !Array.isArray(msg.content)) {
      return;
    }
    const results = msg.content.filter((b): b is Rec => isObj(b) && b.type === 'tool_result');
    for (const block of results) {
      const id = str(block.tool_use_id);
      const tool = this.pending.get(id);
      if (!tool) {
        continue;
      }
      this.pending.delete(id);
      // toolUseResult belongs to the record; trust it only when the record
      // carries a single result.
      const tur = results.length === 1 && isObj(rec.toolUseResult) ? rec.toolUseResult : {};
      const content = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((c) => (isObj(c) ? str(c.text) : '')).join('\n')
          : '';
      const cwd = str(rec.cwd) || this.root;
      const events = this.toolEvents(tool, tur, content, block.is_error === true, cwd, id, ts, out);
      if (events.length && tool.caption) {
        events[0].caption = tool.caption;
      }
      out.events.push(...events);
    }
  }

  private base(op: ActivityEvent['op'], tool: string, abs: string, toolUseId: string, ts: string): ActivityEvent {
    return {
      ts,
      op,
      file: abs ? displayPath(this.root, abs) : '(bash)',
      absFile: abs || undefined,
      agent: this.agent,
      agentId: this.agentId,
      tool,
      session: this.session,
      toolUseId,
    };
  }

  private search(tool: string, rootAbs: string, query: string, hitsAbs: SearchHit[], id: string, ts: string, label: string): ActivityEvent {
    const ev = this.base('search', tool, rootAbs, id, ts);
    const files = new Set(hitsAbs.map((h) => h.file));
    ev.query = query;
    ev.hitCount = hitsAbs.length;
    ev.hits = hitsAbs.slice(0, MAX_HITS).map((h) => ({ ...h, file: displayPath(this.root, h.file), text: h.text ? h.text.slice(0, 200) : undefined }));
    ev.detail = hitsAbs.length
      ? `${label} → ${hitsAbs.length} hit(s) in ${files.size} file(s)`
      : `${label} → no hits`;
    return ev;
  }

  private toolEvents(
    tool: PendingTool,
    tur: Rec,
    content: string,
    isError: boolean,
    cwd: string,
    id: string,
    ts: string,
    out: ParsedRecord,
  ): ActivityEvent[] {
    const input = tool.input;
    const abs = (p: string) => (p ? path.resolve(cwd, p) : '');

    switch (tool.name) {
      case 'Read': {
        if (isError) {
          return [];
        }
        const f = isObj(tur.file) ? tur.file : {};
        const file = abs(str(f.filePath) || str(input.file_path));
        if (!file || this.isNoise(file)) {
          return [];
        }
        const ev = this.base('read', 'Read', file, id, ts);
        const start = num(f.startLine) ?? num(input.offset) ?? 1;
        const count = num(f.numLines) ?? num(input.limit);
        const total = num(f.totalLines);
        if (count && count > 0) {
          ev.startLine = start;
          ev.endLine = start + count - 1;
          ev.lines = count;
          ev.detail = start === 1 && total !== undefined && count >= total
            ? `read whole file (${total} lines)`
            : `read lines ${start}-${ev.endLine}`;
        } else {
          ev.detail = 'read whole file';
        }
        return [ev];
      }

      case 'Edit':
      case 'MultiEdit':
      case 'Write':
      case 'NotebookEdit': {
        if (isError) {
          return [];
        }
        const file = abs(str(tur.filePath) || str(input.file_path) || str(input.notebook_path));
        if (!file || this.isNoise(file)) {
          return [];
        }
        const ev = this.base('write', tool.name, file, id, ts);
        const patch = changedRange(tur.structuredPatch);
        if (tool.name === 'Write' && (tur.type === 'create' || !patch.start)) {
          const n = str(input.content).split(/\r?\n/).length;
          ev.startLine = 1;
          ev.endLine = n;
          ev.lines = n;
          ev.detail = tur.type === 'create' ? `created (${n} lines)` : `rewrote (${n} lines)`;
        } else if (patch.start !== undefined) {
          ev.startLine = patch.start;
          ev.endLine = patch.end;
          ev.lines = patch.added;
          ev.detail = `edited ${patch.added} line(s) @ line ${patch.start}`;
        } else {
          ev.detail = tool.name === 'NotebookEdit' ? 'notebook edit' : 'edited';
        }
        return [ev];
      }

      case 'Grep':
      case 'Glob': {
        if (isError) {
          return [];
        }
        const rootAbs = abs(str(input.path) || '.');
        if (this.isNoise(rootAbs)) {
          return [];
        }
        const query = str(input.pattern);
        const listsFiles = tool.name === 'Glob' || str(input.output_mode) !== 'content';
        let hits: SearchHit[];
        if (Array.isArray(tur.filenames) && listsFiles) {
          hits = tur.filenames.map((f) => ({ file: abs(str(f)) }));
        } else {
          hits = parseHits(content, { file: rootAbs, listsFiles }, cwd);
        }
        return [this.search(tool.name, rootAbs, query, hits, id, ts, `${tool.name.toLowerCase()} "${query.slice(0, 48)}"`)];
      }

      case 'Bash': {
        const command = str(input.command);
        const actions = parseBash(command, cwd).filter((a) => !this.isNoise(a.file));
        const searches = actions.filter((a) => a.kind === 'search');
        const hitsBySearch = attributeHits(str(tur.stdout) || content, searches, cwd);
        const events: ActivityEvent[] = [];
        for (const a of actions) {
          if (a.kind === 'search') {
            const hits = hitsBySearch[searches.indexOf(a)].filter((h) => !this.isNoise(h.file));
            events.push(this.search(a.tool, a.file, a.query ?? '', hits, id, ts, a.detail));
          } else if (!isError) {
            const ev = this.base(a.kind, a.tool, a.file, id, ts);
            ev.startLine = a.startLine;
            ev.endLine = a.endLine;
            ev.detail = a.detail;
            events.push(ev);
          }
        }
        if (!events.length) {
          const ev = this.base('bash', 'Bash', '', id, ts);
          const desc = str(input.description) || command;
          ev.detail = `$ ${oneLine(desc, 80)}`;
          events.push(ev);
        }
        return events;
      }

      case 'Agent':
      case 'Task': {
        out.meta.push({
          kind: 'spawn',
          spawn: {
            toolUseId: id,
            agentType: str(input.subagent_type) || 'general-purpose',
            description: str(input.description),
            agentId: str(tur.agentId) || undefined,
          },
        });
        return [];
      }

      default:
        return [];
    }
  }
}
