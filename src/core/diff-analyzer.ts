import { DiffResult, FlattenedJSON, NestedJSON } from '../types/index.js';
import { flatten } from '../utils/json-utils.js';
import { isKeySkipped } from '../utils/path-matcher.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

interface SourceSnapshot {
  [fileAndLang: string]: Record<string, string>;
}

let snapshot: SourceSnapshot = {};
let snapshotPath = '';
let snapshotDirty = false;

function md5(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}

export async function loadSnapshot(cachePath: string): Promise<void> {
  snapshotPath = cachePath.replace(/\.json$/, '') + '.snapshot.json';
  try {
    const data = await fs.readFile(snapshotPath, 'utf-8');
    snapshot = JSON.parse(data);
  } catch {
    snapshot = {};
  }
}

export async function saveSnapshot(): Promise<void> {
  if (!snapshotDirty || !snapshotPath) return;
  const dir = path.dirname(snapshotPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  snapshotDirty = false;
}

export function updateSnapshot(filePath: string, targetLang: string, key: string, sourceText: string): void {
  const k = `${targetLang}:${filePath}`;
  if (!snapshot[k]) snapshot[k] = {};
  snapshot[k][key] = md5(sourceText);
  snapshotDirty = true;
}

function getSnapshotHash(filePath: string, targetLang: string, key: string): string | undefined {
  return snapshot[`${targetLang}:${filePath}`]?.[key];
}

export function removeSnapshotKeys(filePath: string, targetLang: string, keys: string[]): void {
  const k = `${targetLang}:${filePath}`;
  if (!snapshot[k]) return;
  for (const key of keys) {
    delete snapshot[k][key];
  }
  snapshotDirty = true;
}

export function analyzeDiff(
  baseContent: NestedJSON,
  targetContent: NestedJSON | null,
  skipPatterns: string[] = [],
  filePath?: string,
  targetLang?: string,
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

    const stillEnglish = targetFlattened[key] === baseFlattened[key];

    if (hasSnapshot) {
      const prevHash = getSnapshotHash(filePath, targetLang, key);
      const currHash = md5(baseFlattened[key]);

      if (!prevHash) {
        stillEnglish ? modified.push(key) : unchanged.push(key);
      } else if (prevHash !== currHash) {
        modified.push(key);
      } else {
        unchanged.push(key);
      }
    } else {
      stillEnglish ? modified.push(key) : unchanged.push(key);
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

