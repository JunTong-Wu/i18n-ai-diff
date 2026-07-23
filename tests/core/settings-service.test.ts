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
  it('loads visual config fields and patches managed config properties without replacing custom source', async () => {
    const { projectRoot, configPath, config } = await createSettingsFixture();
    const service = new TranslationSettingsService(config, configPath, projectRoot);

    const loaded = await service.getConfig('token-1');
    expect(loaded.writeToken).toBe('token-1');
    expect(loaded.config.localesDir).toBe('./locales');
    expect(loaded.config.cachePath).toBe('./state/cache.json');
    expect(loaded.config.routes).toEqual([
      { sourceLang: 'en', targetLangs: ['de', 'fr'] },
    ]);
    expect(loaded.raw).not.toContain('test-secret');

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
    expect(saved.raw).not.toContain('test-secret');
    expect(raw).toContain("import { defineConfig } from 'i18n-ai-diff';");
    expect(raw).toContain('function loadLocalEnv()');
    expect(raw).toContain('custom env loader should survive visual settings saves');
    expect(raw).toContain('sourceLang: "zh-Hans"');
    expect(raw).toContain('Keep brand terms stable.');
    expect(raw).toContain('watch: {');
    expect(raw).toContain('debounceMs: 300');
    expect(raw).not.toContain('enabled: false');
    expect(raw).not.toContain('enabled: true');
    expect(raw).toContain("apiKey: 'test-secret'");
    expect(raw).toContain("model: process.env.CUSTOM_TRANSLATION_MODEL || 'test-model'");
    expect(raw).not.toContain('process.env.OPENAI_MODEL');
  });

  it('rejects stale config revisions without overwriting the disk file', async () => {
    const { projectRoot, configPath, config } = await createSettingsFixture();
    const service = new TranslationSettingsService(config, configPath, projectRoot);
    const loaded = await service.getConfig('token-1');
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

  it('does not let display-only llm draft values block managed field saves', async () => {
    const { projectRoot, configPath, config } = await createSettingsFixture();
    const service = new TranslationSettingsService(config, configPath, projectRoot);
    const loaded = await service.getConfig('token-1');

    const saved = await service.saveConfig({
      revision: loaded.revision,
      config: {
        ...loaded.config,
        llm: {
          ...loaded.config.llm,
          model: '',
          baseURL: 'not a url',
          maxTokens: -1,
        },
        prompt: 'Updated managed prompt.',
      },
    });

    const raw = await fs.readFile(configPath, 'utf8');
    expect(saved.restartRequired).toBe(true);
    expect(raw).toContain('Updated managed prompt.');
    expect(raw).toContain("apiKey: 'test-secret'");
    expect(raw).toContain("model: process.env.CUSTOM_TRANSLATION_MODEL || 'test-model'");
    expect(raw).not.toContain('not a url');
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
    import { defineConfig } from 'i18n-ai-diff';

    loadLocalEnv();

    export default defineConfig({
      // Route ownership is user-documented and should survive.
      routes: [{ sourceLang: 'en', targetLangs: ['de', 'fr'] }],
      localesDir: './locales',
      skipKeys: ['internal.*'],
      llm: {
        apiKey: 'test-secret',
        model: process.env.CUSTOM_TRANSLATION_MODEL || 'test-model',
        maxTokens: 2048,
        temperature: 0.2,
        timeout: 30000,
        retries: 2,
      },
      prompt: 'Use a friendly tone.',
      concurrency: 2,
      batchSize: 10,
      cachePath: './state/cache.json',
    });

    function loadLocalEnv() {
      // custom env loader should survive visual settings saves
    }
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
