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
  active agent is touching and crawls an **articulated, line-drawn spider that
  walks along the code itself** — it drops onto a line and crawls left-to-right
  across the actual characters, then down to the next line:
  - **Writing** → as it walks a line it **weaves a silk web** and *stitches* the
    code behind it, with a caret at the spider.
  - **Reading** → it walks each line sweeping a thin **scan beam**; a whole-file
    read walks the whole file top-to-bottom.
  - **Multiple files at once** → the view **splits into a grid** (up to 4 panes),
    each with its own spider working that file; a pane clears a few seconds after
    its file goes quiet.
  - **Zoom** with the toolbar buttons or **Ctrl/Cmd + mouse wheel**.
  - A **status bubble** over each spider says what it's doing ("✎ edited 5 line(s)
    @ line 142" / "👁 read lines 1–200") — the same detail the terminal shows.

  When the event carries a line range the spider crawls those exact lines.
- **Crawl Map** (`AMLOG: Open Crawl Map`): a bird's-eye view — files as nodes, an
  animated spider per agent crawling between them with a fading silk trail, a
  legend, and a live event ticker. **Zoom** with the wheel or buttons, **drag to
  pan**, and toggle a **Flow Recap** panel that lists, per agent, the ordered
  sequence of reads/writes/searches. Nodes are tinted by the last op
  (read / write / 🔍 search / `$` bash).
- **Focus one agent** — both views have a **Focus** dropdown to pin the view to a
  single agent (e.g. one subagent) and hide the rest.

### What's captured (and where it shows)
The hook records **subagent activity too** — each event is tagged with the agent
(`agent_type`), or `main` for the top-level session.
- **Read / Write / Edit** → the **Code Crawl** (spider walks the code) and the Crawl Map.
- **Grep / Glob (search)** and **Bash** → the **Crawl Map**, ticker and recap
  (they have no single file+lines to walk, so they don't open a Code Crawl pane).
- Not captured: file changes made *inside* a Bash script (only the `Bash` call
  itself is logged, with its command/description).

> Heads-up: the spider shows **completed** tool calls. While an agent is only
> *thinking*, or an edit is proposed but not yet applied/approved, there's no
> event yet — so the view can be momentarily quiet even though an agent is busy.
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
> located in the file). When present the spider walks those exact lines; a
> whole-file read (no range) scans the whole file top-to-bottom.

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

# build an installable .vsix:
npm run pack:vsix    # reliable across Node versions (uses scripts/pack-vsix.js)
npm run package      # the standard vsce path (needs Node 20+ for current vsce)

# install the built .vsix:
code --install-extension amlog-spider-crawler-<version>.vsix
```

`pack:vsix` assembles the VSIX (an OPC ZIP) directly, so it works even on a Node
version too old for the current `@vscode/vsce`.
