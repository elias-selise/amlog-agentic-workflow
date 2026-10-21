import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ActivityEvent } from './types';
import { EventTailer } from './eventTail';
import { ActivityState } from './activityState';
import { SpiderDecorations } from './decorations';
import { CrawlMapPanel } from './crawlMap';
import { CodeCrawlPanel } from './codeCrawl';
import { ActivityTreeProvider } from './treeView';
import { SessionWatcher } from './transcript/sessionWatcher';
import { ReplayPanel } from './replay';

// How many recent events to retain so a crawl map opened mid-run can replay the
// whole recap instead of starting blank.
const BACKLOG_MAX = 5000;
const TRANSCRIPT_POLL_MS = 700;

function config() {
  return vscode.workspace.getConfiguration('amlog');
}

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }
  const root = folder.uri;
  const amlogDir = vscode.Uri.joinPath(root, '.amlog');
  const eventsFile = vscode.Uri.joinPath(root, '.amlog', 'activity', 'events.ndjson');
  const output = vscode.window.createOutputChannel('AMLOG Spider Crawler');

  // The extension activates in every workspace (onStartupFinished) so it is
  // ready the moment `amlog install` wires the hook — but it should stay silent
  // in projects that have no AMLOG activity at all.
  const hasAmlog = () => {
    try {
      return fs.existsSync(amlogDir.fsPath);
    } catch {
      return false;
    }
  };

  const state = new ActivityState(config().get<number>('trailLength', 8));
  const decorations = new SpiderDecorations(
    config().get<boolean>('showDecorations', true),
    config().get<number>('decorationTtlMs', 4000),
  );
  const backlog: ActivityEvent[] = [];
  let crawlMap: CrawlMapPanel | undefined;
  let codeCrawl: CodeCrawlPanel | undefined;
  let lastEvent: ActivityEvent | undefined;

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'amlog.openCodeCrawl';
  statusBar.tooltip = 'Open the AMLOG Code Crawl';
  const refreshStatusBar = () => {
    if (state.totalFiles() === 0 && !hasAmlog()) {
      statusBar.hide();
      return;
    }
    statusBar.text = `$(bug) ${state.activeAgentCount()} agent(s) · ${state.totalFiles()} file(s)`;
    statusBar.show();
  };
  refreshStatusBar();
  state.onDidChange(refreshStatusBar);

  const treeProvider = new ActivityTreeProvider(state, root);
  const treeView = vscode.window.createTreeView('amlogActivity', { treeDataProvider: treeProvider });

  const onEvent = (event: ActivityEvent, live: boolean) => {
    state.apply(event);
    // Gutter markers only for what is happening now, not replayed history.
    if (live && (event.op === 'read' || event.op === 'write')) {
      decorations.onEvent(event);
    }

    backlog.push(event);
    while (backlog.length > BACKLOG_MAX) {
      backlog.shift();
    }
    if (event.op !== 'bash') {
      lastEvent = event;
    }
    crawlMap?.post(event);
    codeCrawl?.post(event, live);

    if (live && event.op === 'write' && config().get<boolean>('autoRevealOnWrite', false)) {
      const uri = path.isAbsolute(event.file) ? vscode.Uri.file(event.file) : vscode.Uri.joinPath(root, event.file);
      vscode.window.showTextDocument(uri, { preview: true, preserveFocus: true }).then(
        undefined,
        () => { /* file may not exist on disk (e.g. deleted) — ignore */ },
      );
    }
  };

  // Primary source: the agents' own session logs (Claude Code transcripts,
  // Codex rollouts, Antigravity conversations): full detail with Bash
  // reads/searches, exact line ranges, captions and tokens. The Claude hook file
  // stays as the fallback for sessions whose transcript can't be found.
  const useTranscripts = config().get<string>('captureSource', 'transcript') === 'transcript';
  const watcher = useTranscripts
    ? new SessionWatcher({
      root: root.fsPath,
      lookbackMs: Math.max(0, config().get<number>('sessionLookbackMinutes', 60)) * 60_000,
      pollMs: TRANSCRIPT_POLL_MS,
      sources: config().get<string[]>('agentSources', ['claude', 'codex', 'antigravity']),
      symbols: config().get<boolean>('resolveSymbols', true),
      writeTraces: config().get<boolean>('writeTraceFile', true),
      traceFallbackDir: path.join(amlogDir.fsPath, 'traces'),
      onEvent,
      onTraceWritten: (file) => output.appendLine(`${new Date().toISOString()}  trace written: ${file}`),
      onError: (message) => output.appendLine(message),
    })
    : undefined;

  let lastRefresh = 0;
  const onHookEvent = (event: ActivityEvent, live: boolean) => {
    if (watcher) {
      if (event.transcript) {
        watcher.addTranscript(event.transcript);
      }
      if (event.session && !watcher.isTracked(event.session) && Date.now() - lastRefresh > 1000) {
        lastRefresh = Date.now();
        watcher.refresh();
      }
      if (event.session && watcher.isTracked(event.session)) {
        return; // the transcript already reports this step, in more detail
      }
    }
    onEvent(event, live);
  };
  const tailer = new EventTailer(eventsFile, onHookEvent);

  context.subscriptions.push(
    output,
    statusBar,
    treeView,
    tailer,
    decorations,
    state,
    { dispose: () => watcher?.dispose() },
    vscode.commands.registerCommand('amlog.openCrawlMap', () => {
      crawlMap = CrawlMapPanel.show(context, backlog);
    }),
    vscode.commands.registerCommand('amlog.openCodeCrawl', () => {
      codeCrawl = CodeCrawlPanel.show(context, root, lastEvent);
    }),
    vscode.commands.registerCommand('amlog.openTraceReplay', () => ReplayPanel.show(context, root)),
    vscode.commands.registerCommand('amlog.exportTraceHtml', () => ReplayPanel.exportHtml(context, root)),
    vscode.commands.registerCommand('amlog.showTraceForSelection', () => ReplayPanel.showForSelection(context, root)),
    vscode.commands.registerCommand('amlog.copyTraceSummary', () => ReplayPanel.copySummary(context, root)),
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
      codeCrawl?.reset();
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
      if (e.affectsConfiguration('amlog.captureSource') || e.affectsConfiguration('amlog.writeTraceFile')
        || e.affectsConfiguration('amlog.sessionLookbackMinutes') || e.affectsConfiguration('amlog.agentSources') || e.affectsConfiguration('amlog.resolveSymbols')) {
        vscode.window.showInformationMessage('AMLOG: reload the window to apply the new capture settings.');
      }
    }),
  );
}

export function deactivate(): void {
  // Disposables registered on context.subscriptions are cleaned up by VS Code.
}
