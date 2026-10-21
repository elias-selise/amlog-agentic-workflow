// The extension's activity event. Two sources produce it:
//  - the Claude Code session transcript (src/transcript/*), the primary source;
//  - one line of .amlog/activity/events.ndjson, as emitted by
//    registry/hooks/amlog-activity-hook.js (fallback). Keep parseEvent in sync
//    with that script.
export type ActivityOp = 'read' | 'write' | 'search' | 'bash';

// One match a search turned up (grep/rg/find output, or the Grep/Glob tools).
export interface SearchHit {
  file: string; // display path (workspace-relative when inside it, else absolute)
  line?: number;
  text?: string;
}

export interface ActivityEvent {
  ts: string;
  op: ActivityOp;
  // Display path: workspace-relative (POSIX) when inside the workspace, else
  // absolute. For a search it is the search root.
  file: string;
  agent: string;
  agentId: string;
  tool: string;
  // Line range / size of the call, when derivable (the same facts the terminal
  // shows, e.g. "read lines 1-200", "wrote 40 lines"). Absent for whole-file
  // reads or when the line couldn't be located.
  startLine?: number;
  endLine?: number;
  lines?: number;
  detail?: string;
  session: string;
  toolUseId: string;
  // Transcript-only extras.
  absFile?: string; // absolute path of `file`
  query?: string; // what a search looked for
  hits?: SearchHit[]; // first matches of a search (capped)
  hitCount?: number; // total matches, including the ones not in `hits`
  caption?: string; // what the agent said just before this step ("why")
  transcript?: string; // hook only: the session transcript it came from
}

// Parse one NDJSON line into an ActivityEvent, or null if it is blank/malformed
// or missing the fields the UI relies on.
export function parseEvent(line: string): ActivityEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const obj = JSON.parse(trimmed);
    const ops = ['read', 'write', 'search', 'bash'];
    if (!obj || typeof obj.file !== 'string' || !ops.includes(obj.op)) {
      return null;
    }
    const num = (v: unknown): number | undefined =>
      (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return {
      ts: typeof obj.ts === 'string' ? obj.ts : new Date().toISOString(),
      op: obj.op,
      file: obj.file,
      agent: typeof obj.agent === 'string' && obj.agent ? obj.agent : 'main',
      agentId: typeof obj.agentId === 'string' ? obj.agentId : '',
      tool: typeof obj.tool === 'string' ? obj.tool : '',
      startLine: num(obj.startLine),
      endLine: num(obj.endLine),
      lines: num(obj.lines),
      detail: typeof obj.detail === 'string' ? obj.detail : '',
      session: typeof obj.session === 'string' ? obj.session : '',
      toolUseId: typeof obj.toolUseId === 'string' ? obj.toolUseId : '',
      transcript: typeof obj.transcript === 'string' ? obj.transcript : undefined,
    };
  } catch {
    return null;
  }
}
