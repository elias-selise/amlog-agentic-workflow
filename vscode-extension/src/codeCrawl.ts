import * as vscode from 'vscode';
import * as fs from 'fs';
import { ActivityEvent } from './types';
import { colorForAgent } from './palette';

// Cap how much of a file we ship into the webview so a huge file can't bloat the
// DOM; the spider crawls the first MAX_LINES lines.
const MAX_LINES = 1200;
const MAX_BYTES = 512 * 1024;

// Owns the single "Code Crawl" webview: it renders the text of the file an agent
// is currently touching and crawls a line-drawn spider over the actual code
// lines. This is the "spider on the file" effect without the editor-overlay
// limit — the webview renders the code itself, so we fully control the canvas.
export class CodeCrawlPanel {
  private static current: CodeCrawlPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private shownFile: string | undefined;

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
    private pending?: ActivityEvent,
  ) {
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
  }

  post(event: ActivityEvent): void {
    if (!this.ready) {
      this.pending = event; // show the latest once the webview reports ready
      return;
    }
    const color = colorForAgent(event.agent);
    const header = { file: event.file, agent: event.agent, op: event.op, color };

    if (event.file === this.shownFile) {
      // Same file: just re-trigger the crawl, no need to resend the text.
      this.panel.webview.postMessage({ type: 'touch', ...header });
      return;
    }

    const lines = this.readLines(event.file);
    if (lines === undefined) {
      // Unreadable (binary/too big/deleted): still move the spider, show a notice.
      this.panel.webview.postMessage({ type: 'touch', ...header });
      return;
    }
    this.shownFile = event.file;
    this.panel.webview.postMessage({ type: 'file', ...header, lines });
  }

  private readLines(file: string): string[] | undefined {
    try {
      const abs = vscode.Uri.joinPath(this.root, file).fsPath;
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > MAX_BYTES) {
        return undefined;
      }
      const text = fs.readFileSync(abs, 'utf8');
      // Reject content that looks binary (NUL byte in the first chunk).
      if (text.slice(0, 4096).includes('\u0000')) {
        return undefined;
      }
      return text.split(/\r?\n/).slice(0, MAX_LINES);
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
  <div id="header">
    <span id="dot"></span>
    <span id="agent">waiting for agent activity…</span>
    <span id="op"></span>
    <span id="file"></span>
  </div>
  <div id="viewport">
    <pre id="code"></pre>
    <div id="spider"></div>
  </div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    CodeCrawlPanel.current = undefined;
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
