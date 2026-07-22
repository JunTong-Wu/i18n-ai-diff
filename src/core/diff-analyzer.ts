import { DiffResult, NestedJSON } from '../types/index.js';
import { flatten, isJsonPointer, jsonPointerToDotPath } from '../utils/json-utils.js';
import { isKeySkipped } from '../utils/path-matcher.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

interface SourceSnapshot {
  [fileAndLang: string]: Record<string, string>;
}

interface SnapshotDocument {
  version?: number;
  entries?: SourceSnapshot;
  owners?: Record<string, string>;
}

export const SNAPSHOT_VERSION = 3;

export class SnapshotStore {
  private entries: SourceSnapshot = {};
  private owners: Record<string, string> = {};
  private legacyBootstrap = false;
  private snapshotPath = '';
  private dirty = false;

  constructor(cachePath?: string) {
    if (cachePath) {
      this.snapshotPath = snapshotPathForCache(cachePath);
    }
  }

  static fromDocument(
    document: SnapshotDocument,
    options: { snapshotPath?: string; legacyBootstrap?: boolean; dirty?: boolean } = {},
  ): SnapshotStore {
    const store = new SnapshotStore();
    store.replaceDocument(document, options);
    return store;
  }

  async load(cachePath?: string): Promise<void> {
    if (cachePath) {
      this.snapshotPath = snapshotPathForCache(cachePath);
    }
    this.dirty = false;
    if (!this.snapshotPath) {
      this.entries = {};
      this.owners = {};
      this.legacyBootstrap = false;
      return;
    }

    try {
      const data = await fs.readFile(this.snapshotPath, 'utf-8');
      const parsed = JSON.parse(data) as SnapshotDocument;
      this.replaceDocument(parsed, {
        snapshotPath: this.snapshotPath,
        legacyBootstrap: parsed.version !== SNAPSHOT_VERSION,
        dirty: false,
      });
    } catch {
      this.entries = {};
      this.owners = {};
      this.legacyBootstrap = false;
    }
  }

  async save(): Promise<void> {
    if (!this.dirty || !this.snapshotPath) return;
    const dir = path.dirname(this.snapshotPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.snapshotPath,
      JSON.stringify({ version: SNAPSHOT_VERSION, entries: this.entries, owners: this.owners }, null, 2),
      'utf-8',
    );
    this.dirty = false;
    this.legacyBootstrap = false;
  }

  setOwner(filePath: string, targetLang: string, sourceLang: string): void {
    if (this.owners[ownerKey(filePath, targetLang)] === sourceLang) return;
    this.owners[ownerKey(filePath, targetLang)] = sourceLang;
    const currentKey = snapshotKey(filePath, sourceLang, targetLang);
    const suffix = snapshotSuffix(filePath, targetLang);
    for (const key of Object.keys(this.entries)) {
      if (key !== currentKey && key.endsWith(suffix)) {
        delete this.entries[key];
      }
    }
    this.dirty = true;
  }

  update(
    filePath: string,
    targetLang: string,
    key: string,
    sourceText: string,
    sourceLang: string = '',
  ): void {
    const k = snapshotKey(filePath, sourceLang, targetLang);
    const nextHash = sourceTextHash(sourceText);
    const currentEntries = this.entries[k];
    const directHash = currentEntries?.[key];
    if (directHash === nextHash) return;
    if (!directHash && isJsonPointer(key)) {
      try {
        if (currentEntries?.[jsonPointerToDotPath(key)] === nextHash) return;
      } catch {
        // Invalid pointer-like keys are ignored by callers that own validation.
      }
    }
    if (!this.entries[k]) this.entries[k] = {};
    this.entries[k][key] = nextHash;
    this.dirty = true;
  }

  getHash(filePath: string, targetLang: string, key: string, sourceLang: string = ''): string | undefined {
    const entries = this.entries[snapshotKey(filePath, sourceLang, targetLang)];
    if (!entries) return undefined;
    const direct = entries[key];
    if (direct || !isJsonPointer(key)) return direct;
    try {
      return entries[jsonPointerToDotPath(key)];
    } catch {
      return undefined;
    }
  }

  owner(filePath: string, targetLang: string): string | undefined {
    return this.owners[ownerKey(filePath, targetLang)];
  }

  isLegacyBootstrap(): boolean {
    return this.legacyBootstrap;
  }

  removeKeys(
    filePath: string,
    targetLang: string,
    keys: string[],
    sourceLang: string = '',
  ): void {
    const k = snapshotKey(filePath, sourceLang, targetLang);
    if (!this.entries[k]) return;
    for (const key of keys) {
      delete this.entries[k][key];
      if (isJsonPointer(key)) {
        try {
          delete this.entries[k][jsonPointerToDotPath(key)];
        } catch {
          // Invalid pointer-like keys are ignored; normal validation happens before removeKeys.
        }
      }
    }
    this.dirty = true;
  }

  removeFile(filePath: string, targetLang: string): void {
    const suffix = snapshotSuffix(filePath, targetLang);
    for (const key of Object.keys(this.entries)) {
      if (key.endsWith(suffix)) delete this.entries[key];
    }
    delete this.owners[ownerKey(filePath, targetLang)];
    this.dirty = true;
  }

  replaceDocument(
    document: SnapshotDocument,
    options: { snapshotPath?: string; legacyBootstrap?: boolean; dirty?: boolean } = {},
  ): void {
    if (options.snapshotPath !== undefined) {
      this.snapshotPath = options.snapshotPath;
    }
    const isCurrentVersion = document.version === SNAPSHOT_VERSION;
    this.entries = isCurrentVersion && document.entries ? cloneSnapshotEntries(document.entries) : {};
    this.owners = isCurrentVersion && document.owners ? { ...document.owners } : {};
    this.legacyBootstrap = options.legacyBootstrap ?? !isCurrentVersion;
    this.dirty = options.dirty ?? false;
  }
}

function cloneSnapshotEntries(entries: SourceSnapshot): SourceSnapshot {
  return Object.fromEntries(
    Object.entries(entries).map(([entryKey, hashes]) => [entryKey, { ...hashes }]),
  );
}

export function createSnapshotStore(cachePath?: string): SnapshotStore {
  return new SnapshotStore(cachePath);
}

const defaultSnapshotStore = new SnapshotStore();

export function sourceTextHash(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}

export function snapshotPathForCache(cachePath: string): string {
  return cachePath.replace(/\.json$/, '') + '.snapshot.json';
}

export async function loadSnapshot(cachePath: string): Promise<void> {
  await defaultSnapshotStore.load(cachePath);
}

export async function saveSnapshot(): Promise<void> {
  await defaultSnapshotStore.save();
}

function snapshotKey(filePath: string, sourceLang: string, targetLang: string): string {
  return `${sourceLang}:${targetLang}:${filePath}`;
}

function snapshotSuffix(filePath: string, targetLang: string): string {
  return `:${targetLang}:${filePath}`;
}

function ownerKey(filePath: string, targetLang: string): string {
  return `${targetLang}:${filePath}`;
}

export function setSnapshotOwner(filePath: string, targetLang: string, sourceLang: string): void {
  defaultSnapshotStore.setOwner(filePath, targetLang, sourceLang);
}

export function updateSnapshot(
  filePath: string,
  targetLang: string,
  key: string,
  sourceText: string,
  sourceLang: string = '',
): void {
  defaultSnapshotStore.update(filePath, targetLang, key, sourceText, sourceLang);
}

export function removeSnapshotKeys(
  filePath: string,
  targetLang: string,
  keys: string[],
  sourceLang: string = '',
): void {
  defaultSnapshotStore.removeKeys(filePath, targetLang, keys, sourceLang);
}

export function removeSnapshotFile(filePath: string, targetLang: string): void {
  defaultSnapshotStore.removeFile(filePath, targetLang);
}

export function analyzeDiff(
  baseContent: NestedJSON,
  targetContent: NestedJSON | null,
  skipPatterns: string[] = [],
  filePath?: string,
  targetLang?: string,
  sourceLang: string = '',
  snapshotStore: SnapshotStore = defaultSnapshotStore,
): DiffResult {
  const baseFlattened = flatten(baseContent);
  const targetFlattened = targetContent ? flatten(targetContent) : {};
  const allBaseKeys = Object.keys(baseFlattened);

  const skipped: string[] = [];
  for (const key of allBaseKeys) {
    if (isKeySkipped(key, skipPatterns)) {
      skipped.push(key);
    }
  }

  const skipSet = new Set(skipped);
  const baseKeys = allBaseKeys.filter(k => !skipSet.has(k));
  const targetKeys = new Set(Object.keys(targetFlattened));

  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];

  const hasSnapshot = filePath && targetLang;

  for (const key of baseKeys) {
    if (!targetKeys.has(key)) {
      added.push(key);
      continue;
    }

    const stillSourceText = targetFlattened[key] === baseFlattened[key];

    if (hasSnapshot) {
      const prevHash = snapshotStore.getHash(filePath, targetLang, key, sourceLang);
      const currHash = sourceTextHash(baseFlattened[key]);
      const owner = snapshotStore.owner(filePath, targetLang);

      if (owner && owner !== sourceLang) {
        // 更换母版只改变后续增量基线，已有目标译文保持不变。
        unchanged.push(key);
      } else if (snapshotStore.isLegacyBootstrap() && !prevHash) {
        // 旧版项目迁移时保留已经核对过的目标译文。
        unchanged.push(key);
      } else if (!prevHash) {
        if (stillSourceText) modified.push(key);
        else unchanged.push(key);
      } else if (prevHash !== currHash) {
        modified.push(key);
      } else {
        unchanged.push(key);
      }
    } else {
      if (stillSourceText) modified.push(key);
      else unchanged.push(key);
    }
  }

  const removed: string[] = [];
  const baseKeySet = new Set(allBaseKeys);
  for (const key of targetKeys) {
    if (!baseKeySet.has(key)) {
      removed.push(key);
    }
  }

  return { added, modified, removed, skipped, unchanged };
}
