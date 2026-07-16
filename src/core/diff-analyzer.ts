import { DiffResult, NestedJSON } from '../types/index.js';
import { flatten } from '../utils/json-utils.js';
import { isKeySkipped } from '../utils/path-matcher.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

interface SourceSnapshot {
  [fileAndLang: string]: Record<string, string>;
}

export const SNAPSHOT_VERSION = 3;
let snapshot: SourceSnapshot = {};
let snapshotOwners: Record<string, string> = {};
let legacyBootstrap = false;
let snapshotPath = '';
let snapshotDirty = false;

export function sourceTextHash(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}

export function snapshotPathForCache(cachePath: string): string {
  return cachePath.replace(/\.json$/, '') + '.snapshot.json';
}

export async function loadSnapshot(cachePath: string): Promise<void> {
  snapshotPath = snapshotPathForCache(cachePath);
  snapshotDirty = false;
  try {
    const data = await fs.readFile(snapshotPath, 'utf-8');
    const parsed = JSON.parse(data) as {
      version?: number;
      entries?: SourceSnapshot;
      owners?: Record<string, string>;
    };
    snapshot = parsed.version === SNAPSHOT_VERSION && parsed.entries ? parsed.entries : {};
    snapshotOwners = parsed.version === SNAPSHOT_VERSION && parsed.owners ? parsed.owners : {};
    // 旧版快照没有版本字段。迁移首跑时将现有目标译文视为已核对资产，
    // 只建立新的 sourceLang 基线，不因配置改为多母版而触发重翻。
    legacyBootstrap = parsed.version !== SNAPSHOT_VERSION;
  } catch {
    snapshot = {};
    snapshotOwners = {};
    legacyBootstrap = false;
  }
}

export async function saveSnapshot(): Promise<void> {
  if (!snapshotDirty || !snapshotPath) return;
  const dir = path.dirname(snapshotPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    snapshotPath,
    JSON.stringify({ version: SNAPSHOT_VERSION, entries: snapshot, owners: snapshotOwners }, null, 2),
    'utf-8',
  );
  snapshotDirty = false;
  legacyBootstrap = false;
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
  snapshotOwners[ownerKey(filePath, targetLang)] = sourceLang;
  const currentKey = snapshotKey(filePath, sourceLang, targetLang);
  const suffix = snapshotSuffix(filePath, targetLang);
  for (const key of Object.keys(snapshot)) {
    if (key !== currentKey && key.endsWith(suffix)) {
      delete snapshot[key];
    }
  }
  snapshotDirty = true;
}

export function updateSnapshot(
  filePath: string,
  targetLang: string,
  key: string,
  sourceText: string,
  sourceLang: string = '',
): void {
  const k = snapshotKey(filePath, sourceLang, targetLang);
  if (!snapshot[k]) snapshot[k] = {};
  snapshot[k][key] = sourceTextHash(sourceText);
  snapshotDirty = true;
}

function getSnapshotHash(filePath: string, targetLang: string, key: string, sourceLang: string = ''): string | undefined {
  return snapshot[snapshotKey(filePath, sourceLang, targetLang)]?.[key];
}

export function removeSnapshotKeys(
  filePath: string,
  targetLang: string,
  keys: string[],
  sourceLang: string = '',
): void {
  const k = snapshotKey(filePath, sourceLang, targetLang);
  if (!snapshot[k]) return;
  for (const key of keys) {
    delete snapshot[k][key];
  }
  snapshotDirty = true;
}

export function removeSnapshotFile(filePath: string, targetLang: string): void {
  const suffix = snapshotSuffix(filePath, targetLang);
  for (const key of Object.keys(snapshot)) {
    if (key.endsWith(suffix)) delete snapshot[key];
  }
  delete snapshotOwners[ownerKey(filePath, targetLang)];
  snapshotDirty = true;
}

export function analyzeDiff(
  baseContent: NestedJSON,
  targetContent: NestedJSON | null,
  skipPatterns: string[] = [],
  filePath?: string,
  targetLang?: string,
  sourceLang: string = '',
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
      const prevHash = getSnapshotHash(filePath, targetLang, key, sourceLang);
      const currHash = sourceTextHash(baseFlattened[key]);
      const owner = snapshotOwners[ownerKey(filePath, targetLang)];

      if (owner && owner !== sourceLang) {
        // 更换母版只改变后续增量基线，已有目标译文保持不变。
        unchanged.push(key);
      } else if (legacyBootstrap && !prevHash) {
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
