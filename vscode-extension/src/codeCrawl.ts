import * as vscode from 'vscode';
import * as fs from 'fs';
import { ActivityEvent } from './types';
import { colorForAgent } from './palette';

// Cap how much of a file we ship into the webview so a huge file can't bloat the
// DOM; the spider crawls the first MAX_LINES lines.
const MAX_LINES = 1200;
const MAX_BYTES = 512 * 1024;

// How many files can be "crawled" at once (a grid of panes), and how long a
// pane lingers after its file's last event before it is dropped.
const MAX_PANES = 4;
const PANE_TTL_MS = 10000;

interface PaneState {
  file: string;
  agent: string;
  op: 'read' | 'write';
  color: string;
  startLine?: number;
  endLine?: number;
  detail: string;
  lastSeen: number;
  sentMtime: number; // mtime whose content we last shipped (-1 = none sent)
}

// Owns the single "Code Crawl" webview. When one file is active it fills the
// view; when several files are touched close together it splits into a grid of
// panes, each with its own spider working that file. The webview renders the
// code itself, so the animation isn't bound by the editor-decoration limit.
export class CodeCrawlPanel {
  private static current: CodeCrawlPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private readonly panes = new Map<string, PaneState>();
  private pending?: ActivityEvent;
  private sweepTimer?: ReturnType<typeof setInterval>;

  static show(context: vscode.ExtensionContext, root: vscode.Uri, last?: ActivityEvent): CodeCrawlPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (CodeCrawlPanel.current) {
      CodeCrawlPanel.current.panel.reveal(column);
      return CodeCrawlPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'amlogCodeCrawl',
      'AMLOG Code Crawl',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );
    CodeCrawlPanel.current = new CodeCrawlPanel(panel, context, root, last);
    return CodeCrawlPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly root: vscode.Uri,
    last?: ActivityEvent,
  ) {
    this.pending = last;
    this.panel.webview.html = this.html(context.extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'ready') {
          this.ready = true;
          if (this.pending) {
            this.post(this.pending);
            this.pending = undefined;
          }
        }
      },
      null,
      this.disposables,
    );

    // Expire quiet panes even when no new events arrive to drive pruning.
    this.sweepTimer = setInterval(() => {
      if (!this.ready || this.panes.size === 0) {
        return;
      }
      const before = this.panes.size;
      this.prune(Date.now());
      if (this.panes.size !== before) {
        this.sendPanes();
      }
    }, 1500);
  }

  post(event: ActivityEvent): void {
    // Code Crawl walks real code — only read/write map to a file + lines.
    if (event.op !== 'read' && event.op !== 'write') {
      return;
    }
    if (!this.ready) {
      this.pending = event; // replay the latest once the webview reports ready
      return;
    }

    const now = Date.now();
    const existing = this.panes.get(event.file);
    const pane: PaneState = existing ?? {
      file: event.file,
      agent: event.agent,
      op: event.op,
      color: colorForAgent(event.agent),
      detail: event.detail || '',
      lastSeen: now,
      sentMtime: -1,
    };
    pane.agent = event.agent;
    pane.op = event.op;
    pane.color = colorForAgent(event.agent);
    pane.startLine = event.startLine;
    pane.endLine = event.endLine;
    pane.detail = event.detail || '';
    pane.lastSeen = now;
    this.panes.set(event.file, pane);

    this.prune(now);
    this.sendPanes();
  }

  // Drop panes whose file has been quiet past the TTL, and keep only the most
  // recently active MAX_PANES so the grid stays readable.
  private prune(now: number): void {
    for (const [file, p] of this.panes) {
      if (now - p.lastSeen > PANE_TTL_MS) {
        this.panes.delete(file);
      }
    }
    if (this.panes.size > MAX_PANES) {
      const keep = [...this.panes.values()]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, MAX_PANES);
      const keepSet = new Set(keep.map((p) => p.file));
      for (const file of [...this.panes.keys()]) {
        if (!keepSet.has(file)) {
          this.panes.delete(file);
        }
      }
    }
  }

  private sendPanes(): void {
    const panes = [...this.panes.values()]
      .sort((a, b) => a.lastSeen - b.lastSeen) // stable-ish: oldest first, newest last
      .map((p) => {
        const info = this.readLines(p.file);
        const base = {
          file: p.file,
          agent: p.agent,
          op: p.op,
          color: p.color,
          startLine: p.startLine,
          endLine: p.endLine,
          detail: p.detail,
        };
        // Only ship the text when the pane is new or its content changed (write),
        // so re-touches of an unchanged file stay cheap.
        if (info && info.mtime !== p.sentMtime) {
          p.sentMtime = info.mtime;
          return { ...base, lines: info.lines };
        }
        if (!info) {
          return { ...base, unreadable: true };
        }
        return base;
      });
    this.panel.webview.postMessage({ type: 'panes', panes });
  }

  private readLines(file: string): { lines: string[]; mtime: number } | undefined {
    try {
      const abs = vscode.Uri.joinPath(this.root, file).fsPath;
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > MAX_BYTES) {
        return undefined;
      }
      const text = fs.readFileSync(abs, 'utf8');
      if (text.slice(0, 4096).includes('\u0000')) {
        return undefined; // looks binary
      }
      return { lines: text.split(/\r?\n/).slice(0, MAX_LINES), mtime: stat.mtimeMs };
    } catch {
      return undefined;
    }
  }

  private html(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'codecrawl.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'codecrawl.css'));
    const nonce = nonceString();
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${style}" rel="stylesheet" />
  <title>AMLOG Code Crawl</title>
</head>
<body>
  <div id="toolbar">
    <span id="status">waiting for agent activity…</span>
    <label class="focus-label">Focus <select id="focus"><option value="">all agents</option></select></label>
    <span id="zoom-controls">
      <button id="zoom-out" title="Zoom out (Ctrl+-)">−</button>
      <span id="zoom-level">100%</span>
      <button id="zoom-in" title="Zoom in (Ctrl++)">+</button>
      <button id="zoom-reset" title="Reset zoom">⤢</button>
    </span>
  </div>
  <div id="panes"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    CodeCrawlPanel.current = undefined;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function nonceString(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
