import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProjectSession } from '../../src/core/project-session.js';

const tempDirs: string[] = [];

async function writeJson(root: string, relativePath: string, content: unknown): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('ProjectSession', () => {
  it('builds a non-mutating multi-master translation plan without exposing secrets', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-session-'));
    tempDirs.push(root);
    await Promise.all([
      writeJson(root, 'locales/en/common.json', { greeting: 'Hello', newKey: 'New' }),
      writeJson(root, 'locales/de/common.json', { greeting: 'Hallo', obsolete: 'Alt' }),
      writeJson(root, 'locales/zh-Hans/common.json', { greeting: '你好' }),
      writeJson(root, 'locales/ja/common.json', { greeting: 'こんにちは' }),
      writeJson(root, 'cache.json', {
        version: '2.0.0',
        entries: {
          example: {
            sourceText: 'Hello',
            sourceLang: 'en',
            translatedText: 'Hallo',
            targetLang: 'de',
            timestamp: 1,
            model: 'test-model',
          },
        },
      }),
    ]);
    const configPath = path.join(root, 'i18n-translate.config.json');
    await fs.writeFile(configPath, JSON.stringify({
      routes: [
        { sourceLang: 'zh-Hans', targetLangs: ['ja'] },
        { sourceLang: 'en', targetLangs: ['de'] },
      ],
      localesDir: './locales',
      cachePath: './cache.json',
      llm: { apiKey: 'must-not-leak', model: 'test-model' },
    }), 'utf8');

    const before = await fs.readFile(path.join(root, 'locales/de/common.json'), 'utf8');
    const session = await createProjectSession({
      cwd: root,
      configPath: 'i18n-translate.config.json',
    });
    const result = await session.scan();

    expect(result.mode).toBe('multi-master');
    expect(result.configPath).toBe(configPath);
    expect(result.totals).toEqual({
      routes: 2,
      languages: 4,
      sourceFiles: 2,
      sourceKeys: 3,
      fileTasks: 2,
      pendingFiles: 1,
      pendingKeys: 1,
      removedKeys: 1,
    });
    expect(result.routes[0]).toMatchObject({
      sourceLang: 'zh-Hans',
      targetLangs: ['ja'],
      pendingFiles: 0,
    });
    expect(result.changes).toEqual([
      expect.objectContaining({
        relativePath: 'common.json',
        sourceLang: 'en',
        targetLang: 'de',
        targetExists: true,
        needsWrite: true,
        counts: expect.objectContaining({ added: 1, modified: 0, removed: 1 }),
        keys: { added: ['/newKey'], modified: [], removed: ['/obsolete'] },
      }),
    ]);
    expect(result.cache).toMatchObject({ exists: true, version: '2.0.0', entries: 1 });
    expect(result.snapshot).toMatchObject({ exists: false, version: null });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(await fs.readFile(path.join(root, 'locales/de/common.json'), 'utf8')).toBe(before);
    await expect(fs.access(path.join(root, 'cache.snapshot.json'))).rejects.toThrow();
  });
});
