import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CacheManager } from '../../src/utils/cache-manager.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('multi-master translation cache', () => {
  it('isolates identical source text by source language', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-cache-'));
    const cachePath = path.join(tempDir, 'cache.json');
    const cache = new CacheManager(cachePath);
    await cache.load();

    cache.set('Open', '英語由来', 'ja', 'test-model', 'en');
    cache.set('Open', '中国語由来', 'ja', 'test-model', 'zh-CN');
    await cache.save();

    const reloaded = new CacheManager(cachePath);
    await reloaded.load();
    expect(reloaded.get('Open', 'ja', 'en')).toBe('英語由来');
    expect(reloaded.get('Open', 'ja', 'zh-CN')).toBe('中国語由来');
    expect(reloaded.getStats().totalEntries).toBe(2);
  });

  it('persists an empty v2 cache after resetting an old cache', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-cache-v1-'));
    const cachePath = path.join(tempDir, 'cache.json');
    await fs.writeFile(cachePath, JSON.stringify({ version: '1.0.0', entries: { legacy: {} } }), 'utf-8');

    const cache = new CacheManager(cachePath);
    await cache.load();
    await cache.save();

    const persisted = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
    expect(persisted).toEqual({ version: '2.0.0', entries: {} });
  });
});
