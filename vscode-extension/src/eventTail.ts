import * as vscode from 'vscode';
import * as fs from 'fs';
import { ActivityEvent, parseEvent } from './types';

// Tails `.amlog/activity/events.ndjson`: reads only the bytes appended since the
// last read (so a large log is never re-parsed), survives the hook's size-based
// rotation, and reports whether an initial-backlog or a live event arrived.
export class EventTailer implements vscode.Disposable {
  private offset = 0;
  private partial = '';
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly file: vscode.Uri,
    private readonly onEvent: (event: ActivityEvent, live: boolean) => void,
  ) {
    // Replay the existing backlog once so the map/tree aren't empty on open...
    this.drain(false);
    // ...then follow appends. A glob on the exact path matches create+change+delete.
    this.watcher = vscode.workspace.createFileSystemWatcher(file.fsPath);
    this.disposables.push(
      this.watcher,
      this.watcher.onDidChange(() => this.drain(true)),
      this.watcher.onDidCreate(() => this.drain(true)),
      this.watcher.onDidDelete(() => this.reset()),
    );
  }

  private reset(): void {
    this.offset = 0;
    this.partial = '';
  }

  private drain(live: boolean): void {
    let size: number;
    try {
      size = fs.statSync(this.file.fsPath).size;
    } catch {
      return; // File not there yet.
    }

    // Rotation (or truncation / `clearActivity`): the file shrank, so our old
    // offset is meaningless — start over from the top.
    if (size < this.offset) {
      this.reset();
    }
    if (size === this.offset) {
      return;
    }

    let chunk = '';
    try {
      const fd = fs.openSync(this.file.fsPath, 'r');
      try {
        const length = size - this.offset;
        const buf = Buffer.alloc(length);
        const read = fs.readSync(fd, buf, 0, length, this.offset);
        chunk = buf.toString('utf8', 0, read);
        this.offset += read;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }

    const text = this.partial + chunk;
    const lines = text.split('\n');
    // A final line without a trailing newline is an in-flight append; hold it.
    this.partial = lines.pop() ?? '';
    for (const line of lines) {
      const event = parseEvent(line);
      if (event) {
        this.onEvent(event, live);
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
