import * as os from 'os';
import * as path from 'path';
import { ClaudeTranscriptParser } from './claudeTranscript';
import { ScanContext, SessionSource, TailSpec, listDir, readJsonFile, statOf } from './source';

// Claude Code keeps sessions at
//   <claude config>/projects/<workspace path, non-alphanumerics -> '-'>/<session>.jsonl
//   <same>/<session>/subagents/agent-<id>.jsonl (+ agent-<id>.meta.json: type, description)
// plus any transcript the PostToolUse hook reports (a session started from
// another directory, e.g. a worktree).

export function claudeProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

// Claude Code names a project's transcript folder after its path with every
// non-alphanumeric character replaced by '-'.
export function projectDirFor(root: string): string {
  return path.join(claudeProjectsDir(), root.replace(/[^A-Za-z0-9]/g, '-'));
}

export class ClaudeSource implements SessionSource {
  readonly name = 'claude';
  private readonly dirs = new Set<string>();
  private readonly forced = new Set<string>(); // hook-reported: follow regardless of age

  constructor(private readonly root: string) {
    this.dirs.add(projectDirFor(root));
  }

  // A transcript path reported by the hook (may live outside the workspace's own project folder).
  addTranscript(file: string): void {
    if (file.endsWith('.jsonl')) {
      this.dirs.add(path.dirname(file));
      this.forced.add(file);
    }
  }

  scan(ctx: ScanContext): TailSpec[] {
    const found: TailSpec[] = [];
    for (const dir of this.dirs) {
      for (const name of listDir(dir)) {
        if (!name.endsWith('.jsonl')) {
          continue;
        }
        const file = path.join(dir, name);
        const session = name.slice(0, -'.jsonl'.length);
        if (!ctx.hasTail(file)) {
          const st = statOf(file);
          if (!st || (st.mtimeMs < ctx.cutoffMs && !this.forced.has(file))) {
            continue;
          }
          found.push({ file, session, agent: 'main', agentId: '', parser: new ClaudeTranscriptParser(this.root, session, 'main', '') });
        }
        found.push(...this.scanSubagents(ctx, dir, session));
      }
    }
    return found;
  }

  private scanSubagents(ctx: ScanContext, dir: string, session: string): TailSpec[] {
    const found: TailSpec[] = [];
    const subDir = path.join(dir, session, 'subagents');
    for (const name of listDir(subDir)) {
      const m = /^agent-(.+)\.jsonl$/.exec(name);
      const file = path.join(subDir, name);
      if (!m || ctx.hasTail(file)) {
        continue;
      }
      const meta = readJsonFile(path.join(subDir, `agent-${m[1]}.meta.json`));
      // The meta file lands just after the transcript; wait briefly for it so
      // the first events are labelled with the agent's type.
      if (!meta && ctx.now - (statOf(file)?.mtimeMs ?? 0) < 3000) {
        continue;
      }
      const type = (meta && typeof meta.agentType === 'string' && meta.agentType) || 'subagent';
      found.push({
        file,
        session,
        agent: type,
        agentId: m[1],
        parser: new ClaudeTranscriptParser(this.root, session, type, m[1]),
        description: meta && typeof meta.description === 'string' ? meta.description : undefined,
      });
    }
    return found;
  }
}
