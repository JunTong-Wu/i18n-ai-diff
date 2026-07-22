import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  analyzeDiff,
  createSnapshotStore,
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

    updateSnapshot('common.json', 'ja', '/title', 'Open', 'en');
    setSnapshotOwner('common.json', 'ja', 'en');
    await saveSnapshot();
    await loadSnapshot(cachePath);

    expect(analyzeDiff({ title: 'Open' }, { title: '開く' }, [], 'common.json', 'ja', 'en').unchanged)
      .toEqual(['/title']);
    expect(analyzeDiff({ title: '打开' }, { title: '開く' }, [], 'common.json', 'ja', 'zh-CN').unchanged)
      .toEqual(['/title']);

    updateSnapshot('common.json', 'ja', '/title', '打开', 'zh-CN');
    setSnapshotOwner('common.json', 'ja', 'zh-CN');
    expect(analyzeDiff({ title: '打开' }, { title: '開く' }, [], 'common.json', 'ja', 'zh-CN').unchanged)
      .toEqual(['/title']);
    expect(analyzeDiff({ title: 'Open' }, { title: '開く' }, [], 'common.json', 'ja', 'en').unchanged)
      .toEqual(['/title']);
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
      .toEqual(['/title']);

    updateSnapshot('common.json', 'ja', '/title', 'Open', 'en');
    setSnapshotOwner('common.json', 'ja', 'en');
    await saveSnapshot();
    const migrated = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    expect(migrated.version).toBe(3);
    expect(migrated.owners['ja:common.json']).toBe('en');
  });

  it('reads old v3 dotted snapshot keys without rewriting equivalent pointer keys', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-dotted-v3-snapshot-'));
    const cachePath = path.join(tempDir, 'cache.json');
    const snapshotPath = path.join(tempDir, 'cache.snapshot.json');
    const legacySnapshot = {
      version: 3,
      entries: {
        'en:de:common.json': {
          'section.title': sourceTextHashForTest('Open'),
        },
      },
      owners: {
        'de:common.json': 'en',
      },
    };
    await fs.writeFile(snapshotPath, JSON.stringify(legacySnapshot), 'utf-8');

    await loadSnapshot(cachePath);
    expect(analyzeDiff({ section: { title: 'Open' } }, { section: { title: 'Öffnen' } }, [], 'common.json', 'de', 'en').unchanged)
      .toEqual(['/section/title']);

    updateSnapshot('common.json', 'de', '/section/title', 'Open', 'en');
    setSnapshotOwner('common.json', 'de', 'en');
    await saveSnapshot();
    expect(JSON.parse(await fs.readFile(snapshotPath, 'utf-8'))).toEqual(legacySnapshot);

    updateSnapshot('common.json', 'de', '/section/title', 'Open now', 'en');
    await saveSnapshot();
    const migrated = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
    expect(migrated.entries['en:de:common.json']['/section/title']).toBe(sourceTextHashForTest('Open now'));
  });

  it('keeps explicit snapshot stores isolated across sessions', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-isolated-snapshot-'));
    const storeA = createSnapshotStore(path.join(tempDir, 'project-a-cache.json'));
    const storeB = createSnapshotStore(path.join(tempDir, 'project-b-cache.json'));
    await Promise.all([storeA.load(), storeB.load()]);

    storeA.update('common.json', 'de', '/title', 'Open', 'en');
    storeA.setOwner('common.json', 'de', 'en');

    const source = { title: 'Open now' };
    const target = { title: 'Öffnen' };
    expect(analyzeDiff(source, target, [], 'common.json', 'de', 'en', storeA).modified)
      .toEqual(['/title']);
    expect(analyzeDiff(source, target, [], 'common.json', 'de', 'en', storeB).unchanged)
      .toEqual(['/title']);
  });
});

function sourceTextHashForTest(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}
