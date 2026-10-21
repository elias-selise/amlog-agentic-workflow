# AMLOG Spider Crawler (VS Code extension)

See what your [AMLOG](../AGENTS.md) agents are actually doing. As agents work in
Claude Code, a **line-drawn spider** follows every read, edit and search: live in
the **Code Crawl**, as a bird's-eye **Crawl Map** with a full recap, and as a
shareable **`docs/<issue>/agent-trace.json`** that travels with the PR.

## How it works

1. **Session transcripts (primary source).** Claude Code writes every session to
   `~/.claude/projects/<encoded workspace path>/<session>.jsonl`, and each
   subagent to `<session>/subagents/agent-<id>.jsonl` (+ `.meta.json` with its
   type). The extension tails these files and reads, for every step:
   - `Read` / `Edit` / `Write`: the **exact lines** from the tool result
     (`startLine`/`numLines`, the edit's structured patch);
   - **Bash**: agents navigate mostly with `grep -rn`, `sed -n '120,180p'`,
     `cat`, `head`, `find`. These are parsed into reads (with line ranges) and
     searches (with the query and the hits from the command's output);
   - the agent's **last words before the step** (shown as a caption: the "why");
   - tokens and model per message, the session's cost, the PR it opened.

   Sessions active in the last `amlog.sessionLookbackMinutes` are replayed into
   the recap on startup; anything new plays live.
2. **Hook (fallback).** `amlog install` registers a `PostToolUse` hook
   (`registry/hooks/amlog-activity-hook.js`) that appends to
   `.amlog/activity/events.ndjson`. Its events now carry the session's
   `transcript_path`, so the extension can find transcripts of sessions started
   elsewhere (e.g. a worktree). Hook events for a session whose transcript is
   tracked are dropped as duplicates.
3. **Trace file.** Each session is written (every few seconds while it runs) to
   **`docs/<issue>/agent-trace.json`**, next to the issue's `instructions.md` /
   `plan.md`. The issue folder is the `docs/<n>/` the session touched most. One
   file per issue holds every session that worked on it. Sessions with no issue
   folder go to `.amlog/traces/<session>.json` (gitignored).

Scratch files (temp dirs, `~/.claude`) are left out of the views and the trace.

## What you get

- **Code Crawl** (`AMLOG: Open Code Crawl`): one **lane per live agent** (up to
  four, in a grid). Each lane follows its agent **file by file**:
  - **Read** → the spider crawls along each line of the exact range with a scan
    beam; **write** → it weaves a web and stitches the changed lines.
  - **Search** (`grep`, `rg`, `find`, Grep/Glob) → a search box opens, the spider
    **types the query**, then walks down the **hits** (file:line + matched text,
    like VS Code's search view). Click a hit to open it.
  - **Opening a hit**: when the agent then reads a file from those hits, the
    spider picks that hit row and **lands on the hit line** in the file, then
    crawls the range it read.
  - A **caption** under the header shows what the agent said just before the step.
  - **Keeping in sync:** an agent can read 20 files in one burst. Each lane plays
    its steps one at a time, faster the more are waiting, and drops the oldest if
    it falls far behind, so the live view stays with where the agent is *now*.
    Nothing is lost: the recap and the trace file have every step.
- **Crawl Map** (`AMLOG: Open Crawl Map`): files as nodes, a spider per agent
  crawling between them, a live ticker, and the **Flow Recap**, the complete
  ordered list of every read / edit / search / command per agent (hover a row for
  its time, path and caption). Zoom with the wheel, drag to pan.
- **Trace Replay** (`AMLOG: Open Trace Replay`): opens a `docs/<issue>/agent-trace.json`
  as a review page: header metrics (duration, cost, lines, tokens, models), a
  **timeline with one lane per agent** you can scrub or play, the agent's words
  at each step, and the files read/edited so far. Idle gaps over 30 minutes are
  marked, ops and agents can be filtered, and it follows the file live while an
  agent is still running.
- **Export HTML** (`AMLOG: Export Trace as HTML`, or the button in the replay):
  writes `agent-trace.html` next to the JSON, one self-contained file a PR
  reviewer can open in any browser without the extension.
- **Focus one agent:** both views have a Focus dropdown.
- **Gutter spider + line highlight** on open files an agent just touched
  (`AMLOG: Toggle Spider Decorations`).
- **AMLOG Activity** explorer view (agents → files) and a **status bar** count.
- **Output** channel *AMLOG Spider Crawler*: logs where trace files are written.

### The trace file

```jsonc
{
  "schema": "amlog.agent-trace/v1",
  "issue": "2793",
  "sessions": {
    "<session-id>": {
      "title": "Issue 2793 dependencies", "branch": "…", "startedAt": "…", "endedAt": "…",
      "pr": { "number": 2824, "url": "…" },
      "metrics": { "costUSD": 27.95, "durationMs": 67837214, "linesAdded": 614, "linesRemoved": 150,
                   "tokens": { "claude-opus-5-5": { "input": 956, "output": 133713, "cacheRead": 104787797, … } } },
      "agents": [ { "key": "planner-amlog-fe:adbbc8…", "type": "planner-amlog-fe", "description": "Frontend plan for #2793",
                    "durationMs": …, "steps": 230, "tokens": { … } } ],
      "steps": [ { "t": "…", "agent": "main", "op": "search", "file": "src", "query": "finish_to_start", "hits": 8,
                   "caption": "I'll confirm the link-type numbering…" },
                 { "t": "…", "agent": "main", "op": "read", "file": "src/app/…/gantt.component.ts", "lines": [1120, 1150],
                   "detail": "sed lines 1120-1150" } ]
    }
  }
}
```

Paths outside the workspace are written with `~` instead of your home directory.
It records paths, line ranges, search queries and hit counts, one-line captions
and metrics. It **never** stores file contents or tool output.

**Credentials are masked.** Free text (captions, shell commands, search queries,
agent descriptions, the title) goes through `src/transcript/redact.ts` before it is
written: well-known token formats (GitHub, AWS, Slack, Anthropic/OpenAI, Google,
npm, GitLab, Stripe, JWTs), private-key blocks, `scheme://user:pass@host`,
`Authorization`/`Bearer` values, `--password x`-style flags, `curl -u user:pass`
and `name=value` / `"name": "value"` assignments of names containing
password/secret/token/api-key/credential become `[redacted]`. `redactions` in each
session says how many were masked. This is pattern-based: a secret with no
telltale format or name (a bare random string in prose) can slip through, so skim
a trace before sharing it outside the team.

> Heads-up: steps appear when a tool call **completes**. While an agent is only
> thinking, or an edit is waiting for approval, a lane can be quiet even though
> the agent is busy. Claude Code stores its thinking redacted, so captions come
> from the agent's visible messages only.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `amlog.captureSource` | `transcript` | `transcript` (full detail, hook as fallback) or `hook` (hook file only). Reload after changing. |
| `amlog.sessionLookbackMinutes` | `60` | On startup, replay sessions active within this window. |
| `amlog.writeTraceFile` | `true` | Write `docs/<issue>/agent-trace.json` (or `.amlog/traces/`). |
| `amlog.showDecorations` | `true` | Show the gutter spider / line highlight. |
| `amlog.decorationTtlMs` | `4000` | How long the gutter spider lingers before fading. |
| `amlog.autoRevealOnWrite` | `false` | Open a file in an editor when an agent writes it. |
| `amlog.trailLength` | `8` | Recent files each agent's silk trail connects. |

## Develop

```bash
cd vscode-extension
npm install
npm run compile      # or: npm run watch
# press F5 in VS Code to launch an Extension Development Host

# build an installable .vsix:
npm run pack:vsix    # reliable across Node versions (uses scripts/pack-vsix.js)
npm run package      # the standard vsce path (needs Node 20+ for current vsce)

# install the built .vsix:
code --install-extension amlog-spider-crawler-<version>.vsix
```

`pack:vsix` assembles the VSIX (an OPC ZIP) directly, so it works even on a Node
version too old for the current `@vscode/vsce`.

Source map: `src/transcript/` holds the transcript side (`sessionWatcher.ts`
finds/tails files, `claudeTranscript.ts` turns records into events,
`bashParse.ts` reads shell commands, `traceStore.ts` builds the trace file); none
of it imports `vscode`, so it runs under plain Node. `src/livePlayer.ts` paces
live steps per agent for the Code Crawl. `src/replay.ts` + `media/replay.{js,css}` are
the trace replay (one renderer for the panel and the exported HTML).

### Tests

```bash
npm test      # compiles, then runs test/*.test.js with Node's built-in runner (Node 22+)
```

Covers the Bash parser (grep/sed/cat/find/redirects/heredocs/variables and hit
attribution), the transcript parser, the trace store (merging, privacy,
redaction), the live player's pacing and the watcher's tailing. The tests use
synthetic transcript records (`test/helpers.js`) because real transcripts contain
private code and prompts.
