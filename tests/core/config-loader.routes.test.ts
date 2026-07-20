import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadConfig } from '../../src/core/config-loader.js';

const tempDirs: string[] = [];

async function writeConfig(config: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-config-'));
  tempDirs.push(dir);
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config), 'utf-8');
  return configPath;
}

async function writeTypeScriptConfig(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-config-ts-'));
  tempDirs.push(dir);
  const configPath = path.join(dir, 'i18n-translate.config.ts');
  await fs.writeFile(configPath, source, 'utf-8');
  return configPath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('multi-master config', () => {
  const common = {
    localesDir: './locales',
    llm: { apiKey: 'test-key' },
  };

  it('normalizes single-master config into one route', async () => {
    const config = await loadConfig(await writeConfig({
      ...common,
      baseLang: 'en',
      targetLangs: ['de', 'fr'],
    }));

    expect(config.routes).toEqual([
      { sourceLang: 'en', targetLangs: ['de', 'fr'] },
    ]);
  });

  it('loads sourceLang multi-master routes and preserves compatibility fields', async () => {
    const config = await loadConfig(await writeConfig({
      ...common,
      routes: [
        { sourceLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
        { sourceLang: 'en', targetLangs: ['de', 'fr'] },
      ],
    }));

    expect(config.routes).toHaveLength(2);
    expect(config.routes).toEqual([
      { sourceLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
      { sourceLang: 'en', targetLangs: ['de', 'fr'] },
    ]);
    expect(config.baseLang).toBe('zh-CN');
    expect(config.targetLangs).toEqual(['ja', 'ko', 'de', 'fr']);
  });

  it('accepts legacy baseLang route fields and normalizes them to sourceLang', async () => {
    const config = await loadConfig(await writeConfig({
      ...common,
      routes: [
        { baseLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
        { baseLang: 'en', targetLangs: ['de', 'fr'] },
      ],
    }));

    expect(config.routes).toEqual([
      { sourceLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
      { sourceLang: 'en', targetLangs: ['de', 'fr'] },
    ]);
  });

  it('loads TypeScript config through the packaged CLI loader', async () => {
    const configPath = await writeTypeScriptConfig(`
      type Route = { sourceLang: string; targetLangs: string[] };
      const routes: Route[] = [{ sourceLang: 'zh-CN', targetLangs: ['ja', 'ko'] }];
      export default {
        routes,
        localesDir: './locales',
        llm: { apiKey: 'test-key' },
      };
    `);

    const config = await loadConfig(configPath);
    expect(config.routes).toEqual([
      { sourceLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
    ]);
  });

  it('rejects mixed single-master and multi-master fields', async () => {
    const configPath = await writeConfig({
      ...common,
      baseLang: 'en',
      targetLangs: ['de'],
      routes: [{ sourceLang: 'zh-CN', targetLangs: ['ja'] }],
    });

    await expect(loadConfig(configPath)).rejects.toThrow('either multi-master routes or single-master');
  });

  it.each([
    {
      name: 'a target belongs to multiple masters',
      routes: [
        { sourceLang: 'zh-CN', targetLangs: ['ja'] },
        { sourceLang: 'en', targetLangs: ['ja'] },
      ],
      message: 'assigned to multiple masters',
    },
    {
      name: 'a master is split across multiple routes',
      routes: [
        { sourceLang: 'en', targetLangs: ['de'] },
        { sourceLang: 'en', targetLangs: ['fr'] },
      ],
      message: 'must be configured in a single route',
    },
    {
      name: 'a route targets its own master',
      routes: [{ sourceLang: 'en', targetLangs: ['en'] }],
      message: 'must not contain its sourceLang',
    },
    {
      name: 'a route repeats a target',
      routes: [{ sourceLang: 'en', targetLangs: ['de', 'de'] }],
      message: 'contains duplicate language',
    },
    {
      name: 'a language is both a master and a target',
      routes: [
        { sourceLang: 'en', targetLangs: ['zh-CN'] },
        { sourceLang: 'zh-CN', targetLangs: ['ja'] },
      ],
      message: 'cannot be both a master and a target',
    },
  ])('rejects invalid routes: $name', async ({ routes, message }) => {
    const configPath = await writeConfig({ ...common, routes });
    await expect(loadConfig(configPath)).rejects.toThrow(message);
  });
});
