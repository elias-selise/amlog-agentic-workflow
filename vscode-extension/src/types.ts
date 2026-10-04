// One line of .amlog/activity/events.ndjson, as emitted by
// registry/hooks/amlog-activity-hook.js. Keep this in sync with that script.
export interface ActivityEvent {
  ts: string;
  op: 'read' | 'write';
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
    if (!obj || typeof obj.file !== 'string' || (obj.op !== 'read' && obj.op !== 'write')) {
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
    };
  } catch {
    return null;
  }
}
