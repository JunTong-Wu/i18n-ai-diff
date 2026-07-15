import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  analyzeDiff,
  loadSnapshot,
  saveSnapshot,
  setSnapshotOwner,
  updateSnapshot,
} from '../../src/core/diff-analyzer.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('multi-master snapshots', () => {
  it('preserves existing translations when a target file changes master ownership', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-snapshot-'));
    const cachePath = path.join(tempDir, 'cache.json');
    await loadSnapshot(cachePath);

    updateSnapshot('common.json', 'ja', 'title', 'Open', 'en');
    setSnapshotOwner('common.json', 'ja', 'en');
    await saveSnapshot();
    await loadSnapshot(cachePath);

    expect(analyzeDiff({ title: 'Open' }, { title: '開く' }, [], 'common.json', 'ja', 'en').unchanged)
      .toEqual(['title']);
    expect(analyzeDiff({ title: '打开' }, { title: '開く' }, [], 'common.json', 'ja', 'zh-CN').unchanged)
      .toEqual(['title']);

    updateSnapshot('common.json', 'ja', 'title', '打开', 'zh-CN');
    setSnapshotOwner('common.json', 'ja', 'zh-CN');
    expect(analyzeDiff({ title: '打开' }, { title: '開く' }, [], 'common.json', 'ja', 'zh-CN').unchanged)
      .toEqual(['title']);
    expect(analyzeDiff({ title: 'Open' }, { title: '開く' }, [], 'common.json', 'ja', 'en').unchanged)
      .toEqual(['title']);
  });

  it('treats existing target values as authoritative while bootstrapping a legacy snapshot', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-legacy-snapshot-'));
    const cachePath = path.join(tempDir, 'cache.json');
    const snapshotPath = path.join(tempDir, 'cache.snapshot.json');
    await fs.writeFile(snapshotPath, JSON.stringify({
      'ja:common.json': { title: 'legacy-hash' },
    }), 'utf-8');

    await loadSnapshot(cachePath);
    expect(analyzeDiff({ title: 'Open' }, { title: 'Open' }, [], 'common.json', 'ja', 'en').unchanged)
      .toEqual(['title']);

    updateSnapshot('common.json', 'ja', 'title', 'Open', 'en');
    setSnapshotOwner('common.json', 'ja', 'en');
    await saveSnapshot();
    const migrated = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    expect(migrated.version).toBe(3);
    expect(migrated.owners['ja:common.json']).toBe('en');
  });
});
