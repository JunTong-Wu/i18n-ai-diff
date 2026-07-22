import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ResolvedTranslateConfig } from '../../src/types/index.js';
import {
  SettingsConfigError,
  TranslationSettingsService,
} from '../../src/core/settings-service.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('translation settings service', () => {
  it('loads visual config fields and writes a standard config module behind a revision', async () => {
    const { projectRoot, configPath, config } = await createSettingsFixture();
    const service = new TranslationSettingsService(config, configPath, projectRoot);

    const loaded = await service.getConfig(true, 'token-1');
    expect(loaded.editable).toBe(true);
    expect(loaded.writeToken).toBe('token-1');
    expect(loaded.config.localesDir).toBe('./locales');
    expect(loaded.config.cachePath).toBe('./state/cache.json');
    expect(loaded.config.routes).toEqual([
      { sourceLang: 'en', targetLangs: ['de', 'fr'] },
    ]);

    const saved = await service.saveConfig({
      revision: loaded.revision,
      config: {
        ...loaded.config,
        routes: [
          { sourceLang: 'zh-Hans', targetLangs: ['ja', 'ko'] },
          { sourceLang: 'en', targetLangs: ['de', 'fr'] },
        ],
        llm: {
          ...loaded.config.llm,
          model: 'gpt-4o-mini',
          baseURL: 'https://api.example.test/v1',
        },
        prompt: 'Keep brand terms stable.',
      },
    });

    const raw = await fs.readFile(configPath, 'utf8');
    expect(saved.restartRequired).toBe(true);
    expect(saved.revision).toBe(sha256(raw));
    expect(raw).toContain("import { defineConfig } from 'i18n-ai-diff';");
    expect(raw).toContain('sourceLang: "zh-Hans"');
    expect(raw).toContain('apiKey: process.env.OPENAI_API_KEY');
    expect(raw).not.toContain('test-secret');
  });

  it('rejects stale config revisions without overwriting the disk file', async () => {
    const { projectRoot, configPath, config } = await createSettingsFixture();
    const service = new TranslationSettingsService(config, configPath, projectRoot);
    const loaded = await service.getConfig(true, 'token-1');
    await fs.writeFile(configPath, 'export default { localesDir: "./other", llm: { apiKey: "test-key" }, baseLang: "en", targetLangs: ["de"] };\n', 'utf8');

    await expect(service.saveConfig({
      revision: loaded.revision,
      config: loaded.config,
    })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      status: 409,
    } satisfies Partial<SettingsConfigError>);

    expect(await fs.readFile(configPath, 'utf8')).toContain('./other');
  });
});

async function createSettingsFixture(): Promise<{
  projectRoot: string;
  configPath: string;
  config: ResolvedTranslateConfig;
}> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-settings-'));
  tempDirs.push(projectRoot);
  await fs.mkdir(path.join(projectRoot, 'locales'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'state'), { recursive: true });
  const configPath = path.join(projectRoot, 'i18n-translate.config.ts');
  await fs.writeFile(configPath, `
    export default {
      routes: [{ sourceLang: 'en', targetLangs: ['de', 'fr'] }],
      localesDir: './locales',
      skipKeys: ['internal.*'],
      llm: {
        apiKey: 'test-secret',
        model: 'test-model',
        maxTokens: 2048,
        temperature: 0.2,
        timeout: 30000,
        retries: 2,
      },
      prompt: 'Use a friendly tone.',
      concurrency: 2,
      batchSize: 10,
      cachePath: './state/cache.json',
    };
  `, 'utf8');

  return {
    projectRoot,
    configPath,
    config: {
      routes: [{ sourceLang: 'en', targetLangs: ['de', 'fr'] }],
      baseLang: 'en',
      targetLangs: ['de', 'fr'],
      localesDir: path.join(projectRoot, 'locales'),
      skipKeys: ['internal.*'],
      llm: {
        apiKey: 'test-secret',
        model: 'test-model',
        maxTokens: 2048,
        temperature: 0.2,
        timeout: 30000,
        retries: 2,
      },
      prompt: 'Use a friendly tone.',
      watch: {
        enabled: false,
        debounceMs: 300,
        ignored: ['node_modules/**', '**/*.ts'],
      },
      cachePath: path.join(projectRoot, 'state/cache.json'),
      concurrency: 2,
      batchSize: 10,
    },
  };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
