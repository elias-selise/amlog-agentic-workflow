import * as vscode from 'vscode';
import { ActivityEvent } from './types';
import { EventTailer } from './eventTail';
import { ActivityState } from './activityState';
import { SpiderDecorations } from './decorations';
import { CrawlMapPanel } from './crawlMap';
import { ActivityTreeProvider } from './treeView';

// How many recent events to retain so a crawl map opened mid-run can replay the
// recent crawl instead of starting blank.
const BACKLOG_MAX = 500;

function config() {
  return vscode.workspace.getConfiguration('amlog');
}

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }
  const root = folder.uri;
  const eventsFile = vscode.Uri.joinPath(root, '.amlog', 'activity', 'events.ndjson');

  const state = new ActivityState(config().get<number>('trailLength', 8));
  const decorations = new SpiderDecorations(
    config().get<boolean>('showDecorations', true),
    config().get<number>('decorationTtlMs', 4000),
  );
  const backlog: ActivityEvent[] = [];
  let crawlMap: CrawlMapPanel | undefined;

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'amlog.openCrawlMap';
  statusBar.tooltip = 'Open the AMLOG crawl map';
  const refreshStatusBar = () => {
    statusBar.text = `$(bug) ${state.activeAgentCount()} agent(s) · ${state.totalFiles()} file(s)`;
    statusBar.show();
  };
  refreshStatusBar();
  state.onDidChange(refreshStatusBar);

  const treeProvider = new ActivityTreeProvider(state, root);
  const treeView = vscode.window.createTreeView('amlogActivity', { treeDataProvider: treeProvider });

  const onEvent = (event: ActivityEvent, live: boolean) => {
    state.apply(event);
    decorations.onEvent(event);

    backlog.push(event);
    while (backlog.length > BACKLOG_MAX) {
      backlog.shift();
    }
    crawlMap?.post(event);

    if (live && event.op === 'write' && config().get<boolean>('autoRevealOnWrite', false)) {
      const uri = vscode.Uri.joinPath(root, event.file);
      vscode.window.showTextDocument(uri, { preview: true, preserveFocus: true }).then(
        undefined,
        () => { /* file may not exist on disk (e.g. deleted) — ignore */ },
      );
    }
  };

  const tailer = new EventTailer(eventsFile, onEvent);

  context.subscriptions.push(
    statusBar,
    treeView,
    tailer,
    decorations,
    state,
    vscode.commands.registerCommand('amlog.openCrawlMap', () => {
      crawlMap = CrawlMapPanel.show(context, backlog);
    }),
    vscode.commands.registerCommand('amlog.toggleDecorations', async () => {
      const next = !config().get<boolean>('showDecorations', true);
      await config().update('showDecorations', next, vscode.ConfigurationTarget.Workspace);
      decorations.setEnabled(next);
      vscode.window.showInformationMessage(`AMLOG spider decorations ${next ? 'enabled' : 'disabled'}.`);
    }),
    vscode.commands.registerCommand('amlog.clearActivity', () => {
      state.clear();
      backlog.length = 0;
      crawlMap?.reset();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('amlog.showDecorations')) {
        decorations.setEnabled(config().get<boolean>('showDecorations', true));
      }
      if (e.affectsConfiguration('amlog.decorationTtlMs')) {
        decorations.setTtl(config().get<number>('decorationTtlMs', 4000));
      }
      if (e.affectsConfiguration('amlog.trailLength')) {
        state.setTrailLength(config().get<number>('trailLength', 8));
      }
    }),
  );
}

export function deactivate(): void {
  // Disposables registered on context.subscriptions are cleaned up by VS Code.
}
