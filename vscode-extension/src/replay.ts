import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// "Trace Replay": renders a docs/<issue>/agent-trace.json in a webview (timeline
// scrubber, the agent's words at each step, files touched so far) and exports it
// as one self-contained HTML file a reviewer can open without the extension.

const BODY = `
<div id="empty" class="hidden">No sessions in this trace yet.</div>
<div id="app" class="hidden" style="display:contents">
  <div id="head">
    <div id="title-row">
      <span id="title"></span><span id="sub"></span>
      <span id="actions"><select id="session" class="hidden" title="Session"></select><button id="export" title="Save as a standalone HTML file">Export HTML</button></span>
    </div>
    <div id="stats"></div>
  </div>
  <div id="controls">
    <button id="play" class="primary">▶ Play</button>
    <select id="speed" title="Steps per second"><option value="2">2/s</option><option value="4" selected>4/s</option><option value="10">10/s</option><option value="25">25/s</option></select>
    <input id="scrub" type="range" min="0" max="0" value="0" />
    <span id="pos"></span>
  </div>
  <div id="controls2" style="padding:6px 16px;display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;border-bottom:1px solid var(--border)">
    <div class="chips" id="chips-ops"></div><div class="chips" id="chips-agents"></div>
  </div>
  <div id="timeline-wrap"><canvas id="timeline"></canvas></div>
  <div id="main">
    <div id="left">
      <div><h3>Now</h3><div id="now"></div></div>
      <div><h3 id="files-title">Files touched so far</h3><div id="files"></div></div>
      <div><h3>Agents</h3><div id="agents"></div></div>
    </div>
    <div id="right"><div id="steps"></div></div>
  </div>
</div>`;

export function inlineReplayHtml(extensionUri: vscode.Uri, doc: unknown): string {
  const read = (f: string) => fs.readFileSync(vscode.Uri.joinPath(extensionUri, 'media', f).fsPath, 'utf8');
  // `<` is escaped so trace text can never close the script tag early.
  const data = JSON.stringify(doc).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Agent trace</title><style>${read('replay.css')}</style></head>
<body>${BODY}
<script>window.__TRACE__ = ${data};</script>
<script>${read('replay.js').replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;
}

export async function findTraceFiles(root: vscode.Uri): Promise<vscode.Uri[]> {
  const found = await vscode.workspace.findFiles('{docs/*/agent-trace.json,.amlog/traces/*.json}', '**/node_modules/**', 200);
  const withTime = found.map((u) => ({ u, t: safeMtime(u.fsPath) }));
  withTime.sort((a, b) => b.t - a.t);
  return withTime.map((x) => x.u);
}

function safeMtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function readTrace(file: vscode.Uri): unknown | undefined {
  try {
    return JSON.parse(fs.readFileSync(file.fsPath, 'utf8'));
  } catch {
    return undefined;
  }
}

export class ReplayPanel {
  private static current: ReplayPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  static async show(context: vscode.ExtensionContext, root: vscode.Uri, file?: vscode.Uri): Promise<void> {
    let target = file;
    if (!target) {
      const files = await findTraceFiles(root);
      if (!files.length) {
        vscode.window.showInformationMessage(
          'AMLOG: no agent traces yet. They appear in docs/<issue>/agent-trace.json once an agent has run with the extension active.',
        );
        return;
      }
      if (files.length === 1) {
        target = files[0];
      } else {
        const pick = await vscode.window.showQuickPick(
          files.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })),
          { placeHolder: 'Pick an agent trace to replay' },
        );
        if (!pick) {
          return;
        }
        target = pick.uri;
      }
    }
    if (ReplayPanel.current) {
      ReplayPanel.current.dispose();
    }
    ReplayPanel.current = new ReplayPanel(context, target);
  }

  static async exportHtml(context: vscode.ExtensionContext, root: vscode.Uri, file?: vscode.Uri): Promise<void> {
    let target = file;
    if (!target) {
      const files = await findTraceFiles(root);
      const pick = files.length === 1 ? { uri: files[0] } : await vscode.window.showQuickPick(
        files.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })),
        { placeHolder: 'Pick an agent trace to export' },
      );
      if (!pick) {
        if (!files.length) {
          vscode.window.showInformationMessage('AMLOG: no agent traces to export yet.');
        }
        return;
      }
      target = pick.uri;
    }
    const doc = readTrace(target);
    if (!doc) {
      vscode.window.showErrorMessage('AMLOG: could not read that trace file.');
      return;
    }
    const out = vscode.Uri.file(path.join(path.dirname(target.fsPath), `${path.basename(target.fsPath, '.json')}.html`));
    fs.writeFileSync(out.fsPath, inlineReplayHtml(context.extensionUri, doc), 'utf8');
    const open = await vscode.window.showInformationMessage(`AMLOG: exported ${vscode.workspace.asRelativePath(out)}`, 'Open in browser');
    if (open) {
      vscode.env.openExternal(out);
    }
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(private readonly context: vscode.ExtensionContext, private readonly file: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(
      'amlogTraceReplay',
      `Replay · ${path.basename(path.dirname(file.fsPath)) === 'traces' ? path.basename(file.fsPath) : `#${path.basename(path.dirname(file.fsPath))}`}`,
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        this.send(false);
      } else if (msg?.type === 'export') {
        void ReplayPanel.exportHtml(this.context, vscode.Uri.file(path.dirname(this.file.fsPath)), this.file);
      }
    }, null, this.disposables);

    // The extension rewrites the trace while an agent runs: follow it live.
    const watcher = vscode.workspace.createFileSystemWatcher(this.file.fsPath);
    this.disposables.push(watcher, watcher.onDidChange(() => this.send(true)));
  }

  private send(keep: boolean): void {
    if (this.disposed) {
      return;
    }
    const doc = readTrace(this.file);
    if (doc) {
      this.panel.webview.postMessage({ type: 'trace', doc, keep });
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', f));
    const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" /><link href="${media('replay.css')}" rel="stylesheet" />
<title>AMLOG Trace Replay</title></head>
<body>${BODY}<script nonce="${nonce}" src="${media('replay.js')}"></script></body></html>`;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    ReplayPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
