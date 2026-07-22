import crypto from 'crypto';
import path from 'path';
import chokidar, { FSWatcher } from 'chokidar';
import {
  EditorProjectSyncReason,
  EditorSyncEvent,
  FileChangeType,
  ResolvedTranslateConfig,
} from '../types/index.js';
import { warn } from '../utils/logger.js';
import { snapshotPathForCache } from './diff-analyzer.js';

const SYNC_DEBOUNCE_MS = 500;
const SYNC_MAX_WAIT_MS = 2_000;
const BULK_LOCALE_EVENT_THRESHOLD = 80;

export type EditorSyncListener = (event: EditorSyncEvent) => void;

interface LanguageRoot {
  lang: string;
  root: string;
}

interface PendingLocaleChange {
  relativePath: string;
  languages: Set<string>;
  changes: Set<FileChangeType>;
}

export class PanelFileEventHub {
  private readonly languageRoots: LanguageRoot[];
  private readonly projectFileReasons = new Map<string, EditorProjectSyncReason>();
  private readonly listeners = new Set<EditorSyncListener>();
  private readonly pendingLocaleChanges = new Map<string, PendingLocaleChange>();
  private readonly pendingProjectReasons = new Set<EditorProjectSyncReason>();
  private watcher: FSWatcher | null = null;
  private starting: Promise<void> | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private maxFlushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ResolvedTranslateConfig,
    configPath: string,
  ) {
    const languages = [...new Set(config.routes.flatMap(route => [route.sourceLang, ...route.targetLangs]))];
    this.languageRoots = languages.map(lang => ({
      lang,
      root: path.resolve(config.localesDir, lang),
    }));
    this.projectFileReasons.set(path.resolve(configPath), 'config');
    if (config.cachePath) {
      const cachePath = path.resolve(config.cachePath);
      this.projectFileReasons.set(cachePath, 'cache');
      this.projectFileReasons.set(path.resolve(snapshotPathForCache(cachePath)), 'snapshot');
    }
  }

  subscribe(listener: EditorSyncListener): () => void {
    this.listeners.add(listener);
    void this.start().catch(error => {
      warn(`Could not start panel file sync watcher: ${(error as Error).message}`);
      this.pendingProjectReasons.add('watcher-error');
      this.scheduleFlush();
    });
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) void this.stop();
    };
  }

  async close(): Promise<void> {
    this.listeners.clear();
    await this.stop();
  }

  private async start(): Promise<void> {
    if (this.watcher) return;
    if (this.starting) return this.starting;

    this.starting = new Promise<void>(resolve => {
      const watchPaths = [...new Set([
        ...this.languageRoots.map(root => root.root),
        ...this.projectFileReasons.keys(),
      ])];

      this.watcher = chokidar.watch(watchPaths, {
        ignored: ['**/node_modules/**'],
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100,
        },
      });

      this.watcher
        .on('add', filePath => this.handlePathEvent(filePath, 'add'))
        .on('change', filePath => this.handlePathEvent(filePath, 'change'))
        .on('unlink', filePath => this.handlePathEvent(filePath, 'unlink'))
        .on('error', error => {
          warn(`Panel file sync watcher error: ${error.message}`);
          this.pendingProjectReasons.add('watcher-error');
          this.scheduleFlush();
        })
        .once('ready', () => resolve());
    }).finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  private async stop(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.maxFlushTimer) {
      clearTimeout(this.maxFlushTimer);
      this.maxFlushTimer = null;
    }
    this.pendingLocaleChanges.clear();
    this.pendingProjectReasons.clear();

    const watcher = this.watcher;
    this.watcher = null;
    if (watcher) await watcher.close();
  }

  private handlePathEvent(filePath: string, changeType: FileChangeType): void {
    const resolvedPath = path.resolve(filePath);
    const projectReason = this.projectFileReasons.get(resolvedPath);
    if (projectReason) {
      this.pendingProjectReasons.add(projectReason);
      this.scheduleFlush();
      return;
    }

    const localeFile = this.resolveLocaleFile(resolvedPath);
    if (!localeFile) return;
    const pending = this.pendingLocaleChanges.get(localeFile.relativePath) || {
      relativePath: localeFile.relativePath,
      languages: new Set<string>(),
      changes: new Set<FileChangeType>(),
    };
    pending.languages.add(localeFile.lang);
    pending.changes.add(changeType);
    this.pendingLocaleChanges.set(localeFile.relativePath, pending);
    this.scheduleFlush();
  }

  private resolveLocaleFile(filePath: string): { lang: string; relativePath: string } | null {
    if (path.extname(filePath).toLowerCase() !== '.json') return null;

    for (const root of this.languageRoots) {
      const relativePath = path.relative(root.root, filePath);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;
      if (relativePath.includes('\0')) continue;
      const normalized = toPosixRelativePath(relativePath);
      if (
        normalized === '..'
        || normalized.startsWith('../')
        || normalized.includes('\\')
        || !normalized.endsWith('.json')
      ) continue;
      return { lang: root.lang, relativePath: normalized };
    }
    return null;
  }

  private scheduleFlush(): void {
    if (this.listeners.size === 0) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), SYNC_DEBOUNCE_MS);
    if (!this.maxFlushTimer) {
      this.maxFlushTimer = setTimeout(() => this.flush(), SYNC_MAX_WAIT_MS);
    }
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.maxFlushTimer) {
      clearTimeout(this.maxFlushTimer);
      this.maxFlushTimer = null;
    }

    const localeChanges = [...this.pendingLocaleChanges.values()];
    const projectReasons = [...this.pendingProjectReasons];
    this.pendingLocaleChanges.clear();
    this.pendingProjectReasons.clear();

    if (localeChanges.length === 0 && projectReasons.length === 0) return;

    if (projectReasons.length > 0 || localeChanges.length > BULK_LOCALE_EVENT_THRESHOLD) {
      const reason = projectReasons[0] || 'locales-bulk';
      this.emit({
        type: 'editor:project-changed',
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'filesystem',
        reason,
        relativePaths: localeChanges.map(change => change.relativePath).sort((left, right) => left.localeCompare(right)),
        languages: sortedUnique(localeChanges.flatMap(change => [...change.languages])),
        count: localeChanges.length + projectReasons.length,
      });
      return;
    }

    for (const change of localeChanges) {
      this.emit({
        type: 'editor:file-changed',
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'filesystem',
        relativePath: change.relativePath,
        languages: [...change.languages].sort((left, right) => left.localeCompare(right)),
        changes: [...change.changes].sort((left, right) => left.localeCompare(right)),
      });
    }
  }

  private emit(event: EditorSyncEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toPosixRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}
