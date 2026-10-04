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

- **Gutter spider + line highlight** on any open file an agent just touched,
  colored per agent, fading after a few seconds. *(Command: `AMLOG: Toggle Spider
  Decorations`.)*
- **Crawl Map** (`AMLOG: Open Crawl Map`): files as nodes, an animated spider per
  agent crawling between them with a fading silk trail, a legend, a live event
  ticker, and pause/resume.
- **AMLOG Activity** explorer view: agents → the files each has read/written.
- **Status bar**: active agent count and files touched.

> **Note on the editor overlay:** VS Code's editor API can place a gutter glyph +
> highlight on a file, but cannot free-draw an animated sprite over your code. The
> smooth crawling animation therefore lives in the Crawl Map webview; the gutter
> spider is a static per-line glyph that hops between files as events arrive.

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
