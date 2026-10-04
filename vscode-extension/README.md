# AMLOG Spider Crawler (VS Code extension)

Live visualization of which files each [AMLOG](../AGENTS.md) agent reads and writes.
As agents work inside Claude Code, a **line-drawn spider** appears on the files
they touch and crawls between them in an animated **Crawl Map**.

## How it works

1. `amlog install` registers a Claude Code `PostToolUse` hook
   (`registry/hooks/amlog-activity-hook.js`) that appends one NDJSON line per file
   `Read`/`Write`/`Edit` to **`.amlog/activity/events.ndjson`**, tagged with the
   acting agent (`agent_type`) — or `main` for the top-level session.
2. This extension tails that file live and renders the activity.

So the extension needs no connection to Claude Code itself; it only watches the
workspace file the hook writes. Run `amlog install` (Claude Code adapter) first.

## What you get

- **Code Crawl** (`AMLOG: Open Code Crawl`): renders the text of the file the
  active agent is touching and crawls an **articulated, line-drawn spider over the
  actual code lines**, so what you see maps to what the agent is doing:
  - **Writing** → the spider walks down the edited run, **weaving a silk web**
    over the lines it writes and *stitching* each line left-to-right with a caret.
  - **Reading** → it scans the range, sweeping a thin **scan beam** across each
    line it inspects.
  - A **status bubble** over the spider says what it's doing ("✎ edited 5 line(s)
    @ line 142" / "👁 read lines 1–200") — the same detail the terminal shows.

  When the event carries a line range the spider crawls those exact lines. This is
  the literal "spider on the file" effect.
- **Crawl Map** (`AMLOG: Open Crawl Map`): a bird's-eye view — files as nodes, an
  animated spider per agent crawling between them with a fading silk trail, a
  legend, a live event ticker, and pause/resume.
- **Gutter spider + line highlight** on any open file an agent just touched,
  colored per agent, fading after a few seconds. *(Command: `AMLOG: Toggle Spider
  Decorations`.)*
- **AMLOG Activity** explorer view: agents → the files each has read/written.
- **Status bar**: active agent count and files touched.

> **Why two webviews rather than drawing on the editor:** VS Code's editor API
> can only place a gutter glyph + line highlight — it can't free-draw an animated
> sprite over live code. So the real crawling animation lives in the **Code Crawl**
> webview, which renders the file's text itself (a read-only view) and animates
> the spider over those lines. The gutter decoration remains as a lightweight
> marker inside the real editable editor.
>
> *Line targeting:* the capture hook derives the line range from the tool call's
> `tool_input` (`Read` offset/limit, `Write`/`Edit` line counts, Edit start line
> located in the file). When present the spider crawls those exact lines; when not
> derivable (e.g. a whole-file read) it falls back to a plausible working pattern.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
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
npm run package      # build a .vsix (requires @vscode/vsce)
```
