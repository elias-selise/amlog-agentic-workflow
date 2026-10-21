# AMLOG Spider Crawler (VS Code extension)

See what your [AMLOG](../AGENTS.md) agents are actually doing. As agents work in
Claude Code, Codex or Antigravity, a **line-drawn spider** follows every read, edit and search: live in
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

## Supported agents

| Agent | Where its log is read from | What you get |
| --- | --- | --- |
| **Claude Code** | `~/.claude/projects/<workspace>/<session>.jsonl` + `subagents/` | Everything below, including subagents. |
| **Codex CLI** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | Shell reads/searches (`exec_command` and the `exec` tool, parsed like Bash), **exact edit lines** from `apply_patch` diffs, captions, tokens. |
| **Antigravity CLI** | `~/.gemini/antigravity-cli/brain/<conversation>/.system_generated/logs/transcript_full.jsonl` | Reads (`view_file` with line ranges), edits (`replace_file_content`, `write_to_file`…), shell, `grep_search`/`find_by_name`/`list_dir`, captions from each call's summary, tokens. |

Only sessions that worked in **this workspace or another git worktree of the same
repository** are read; others are never opened beyond their first few records.
Every agent shows as its own lane / agent colour, and each session in the trace
file says which agent wrote it (`source`). Pick the agents with
`amlog.agentSources` (default: all three).

Limits per agent, from what each log contains:
- **Codex**: a `Plan` and reasoning are not shown; edits without a diff in the log
  (rare) show no line range.
- **Antigravity**: tool results carry no call id and parallel calls finish in any
  order, so exit codes and `find`/shell search hits are attached only when a turn
  made a single call. `grep_search` hits are not itemised in the log (the search
  is shown without a hit list). Conversations are matched to the workspace by the
  first files they touch, as the log has no working directory.
- The Claude-only hook fallback and the `transcript_path` handshake do not apply
  to the other two.

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
  agent is still running. On top of the raw steps it works out:
  - **Phases** (explore / plan / implement / verify / ship) as a band above the
    timeline: click one to jump there. Inferred from the agents' roles, what they
    edited and which commands they ran, so treat them as a guide, not a log.
  - **What led to each step**: "Led here by ⌕ query" when a step opens a file a
    search found, and "Context for this edit" listing the files read since the
    agent's previous edit. Each is a link.
  - **Worth a look**: files read or rewritten again and again, runs of searches
    that found nothing, repeated queries, failed tool calls per agent, long idle
    time. Pointers, not verdicts; plan/notes files are not counted as churn.
  - **Flow** tab: queries → files read → files edited, as of the current step
    (purple: a search led to the file; blue: read before an edit).
  - **Symbols**: for steps captured live, the function/class around the lines
    ("edited `parseInvoice`"), from the repo's CodeGraph index (needs Node 22+ in
    VS Code and an index; silently off otherwise). The names are kept when the
    trace is rebuilt after a restart; steps replayed from history are not named,
    because the index describes today's code.
- **Show Agent Trace for This Code** (editor context menu, `AMLOG: Show Agent
  Trace for This Code`): pick the steps from any recorded trace that edited (or
  read) the selected lines, and the replay opens at that step with the agent's
  reason. This is the answer to "why is this line like this?".
- **Copy Trace Summary for PR** (`AMLOG: Copy Trace Summary for PR`): a short
  markdown summary (agents, phases, edited files with symbols, what is worth a
  look) on the clipboard, to paste into a PR description if you want one.
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
It records paths, line ranges, search queries, hit counts and the *paths* a search
found, one-line captions, failed-call counts and metrics. It **never** stores file contents or tool output.

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
| `amlog.resolveSymbols` | `true` | Name the function/class around live steps from the repo's CodeGraph index. Reload after changing. |
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

### Trace files stay local

`amlog install` / `amlog update` add `docs/*/agent-trace.json` and
`docs/*/agent-trace.html` to the workspace's `.gitignore`: the trace is for the
developer looking at how an agent worked, not something the PR needs, and this
stops an agent's commit step from picking it up. To share traces through git
instead, delete those two lines.
