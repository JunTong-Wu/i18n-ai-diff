import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { sourceTextHash } from '../../src/core/diff-analyzer.js';
import { Translator, createTranslator } from '../../src/core/translator.js';
import { FailureLogger } from '../../src/utils/failure-logger.js';
import type { TranslateConfig, TranslationResult, TranslationTask } from '../../src/types/index.js';

let tempDir: string | undefined;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), 'utf-8');
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('multi-master translator', () => {
  it('only generates each target from its configured master', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-translator-'));
    const localesDir = path.join(tempDir, 'locales');

    await writeJson(path.join(localesDir, 'zh-CN/common.json'), { title: '打开', brand: 'ACME' });
    await writeJson(path.join(localesDir, 'zh-CN/pages/account.json'), { account: '账户' });
    await writeJson(path.join(localesDir, 'en/common.json'), { title: 'Open', brand: 'ACME' });
    await writeJson(path.join(localesDir, 'en/pages/home.json'), { home: 'Home' });

    const config: TranslateConfig = {
      routes: [
        { sourceLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
        { sourceLang: 'en', targetLangs: ['de', 'fr'] },
      ],
      baseLang: 'zh-CN',
      targetLangs: ['ja', 'ko', 'de', 'fr'],
      localesDir,
      skipKeys: ['brand'],
      llm: { apiKey: 'test-key', model: 'test-model' },
      cachePath: path.join(tempDir, 'cache.json'),
      concurrency: 2,
      batchSize: 100,
    };

    const translator = new Translator(config);
    await translator.initialize();
    const translateBatch = vi.fn(async (tasks: TranslationTask[]): Promise<TranslationResult[]> =>
      tasks.map(task => ({
        key: task.key,
        translatedText: `${task.sourceLang}->${task.targetLang}:${task.sourceText}`,
        targetLang: task.targetLang,
        success: true,
      }))
    );
    (translator as unknown as { llmClient: { translateBatch: typeof translateBatch } }).llmClient = { translateBatch };

    const stats = await translator.translateAll();

    expect(stats.totalFiles).toBe(8);
    expect((await readJson(path.join(localesDir, 'ja/common.json'))).title).toBe('zh-CN->ja:打开');
    expect((await readJson(path.join(localesDir, 'de/common.json'))).title).toBe('en->de:Open');
    expect((await readJson(path.join(localesDir, 'ja/common.json'))).brand).toBe('ACME');
    expect((await readJson(path.join(localesDir, 'de/common.json'))).brand).toBe('ACME');

    await expect(fs.access(path.join(localesDir, 'ja/pages/home.json'))).rejects.toThrow();
    await expect(fs.access(path.join(localesDir, 'de/pages/account.json'))).rejects.toThrow();

    translateBatch.mockClear();
    await translator.translateAll();
    expect(translateBatch).not.toHaveBeenCalled();

    await writeJson(path.join(localesDir, 'en/common.json'), { title: 'Open now', brand: 'ACME' });
    translateBatch.mockClear();
    await translator.translateAll();
    const changedTasks = translateBatch.mock.calls.flatMap(call => call[0]);
    expect(new Set(changedTasks.map(task => task.sourceLang))).toEqual(new Set(['en']));
    expect(new Set(changedTasks.map(task => task.targetLang))).toEqual(new Set(['de', 'fr']));
  });

  it('does not prune old cache entries during no-op incremental runs', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-cache-noop-'));
    const localesDir = path.join(tempDir, 'locales');
    const cachePath = path.join(tempDir, 'cache.json');

    await Promise.all([
      writeJson(path.join(localesDir, 'en/common.json'), { title: 'Open' }),
      writeJson(path.join(localesDir, 'de/common.json'), { title: 'Öffnen' }),
      writeJson(cachePath, {
        version: '2.0.0',
        entries: {
          staleButPreserved: {
            sourceText: 'Open old',
            sourceLang: 'en',
            translatedText: 'Alt',
            targetLang: 'de',
            timestamp: 1,
            model: 'test-model',
          },
        },
      }),
      writeJson(path.join(tempDir, 'cache.snapshot.json'), {
        version: 3,
        entries: {
          'en:de:common.json': { '/title': sourceTextHash('Open') },
        },
        owners: {
          'de:common.json': 'en',
        },
      }),
    ]);

    const translator = new Translator({
      baseLang: 'en',
      targetLangs: ['de'],
      localesDir,
      skipKeys: [],
      llm: { apiKey: 'test-key', model: 'test-model' },
      cachePath,
    });
    await translator.initialize();
    const translateBatch = vi.fn(async (): Promise<TranslationResult[]> => []);
    (translator as unknown as { llmClient: { translateBatch: typeof translateBatch } }).llmClient = { translateBatch };

    const beforeCache = await readJson(cachePath);
    await translator.translateAll();

    expect(translateBatch).not.toHaveBeenCalled();
    expect(await readJson(cachePath)).toEqual(beforeCache);
  });

  it('runs one-time master-to-master translation without touching route snapshots or target-only keys', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-master-to-master-'));
    const localesDir = path.join(tempDir, 'locales');

    await writeJson(path.join(localesDir, 'zh-Hans/common.json'), { title: '你好', skip: '保持' });
    await writeJson(path.join(localesDir, 'en/common.json'), { title: 'Hello', extra: 'Keep me' });

    const translator = new Translator({
      routes: [
        { sourceLang: 'zh-Hans', targetLangs: ['ja'] },
        { sourceLang: 'en', targetLangs: ['de'] },
      ],
      baseLang: 'zh-Hans',
      targetLangs: ['ja', 'de'],
      localesDir,
      skipKeys: ['skip'],
      llm: { apiKey: 'test-key', model: 'test-model' },
      cachePath: path.join(tempDir, 'cache.json'),
      batchSize: 100,
    });
    await translator.initialize();
    const translateBatch = vi.fn(async (tasks: TranslationTask[]): Promise<TranslationResult[]> =>
      tasks.map(task => ({
        key: task.key,
        translatedText: `${task.sourceLang}->${task.targetLang}:${task.sourceText}`,
        targetLang: task.targetLang,
        success: true,
      }))
    );
    (translator as unknown as { llmClient: { translateBatch: typeof translateBatch } }).llmClient = { translateBatch };

    const reviewed = await translator.translateMaster({
      sourceLang: 'zh-Hans',
      targetLang: 'en',
      files: ['common.json'],
    });
    expect(reviewed.totalUpdated).toBe(0);
    expect(translateBatch).not.toHaveBeenCalled();
    expect(await readJson(path.join(localesDir, 'en/common.json'))).toEqual({ title: 'Hello', extra: 'Keep me' });

    const forced = await translator.translateMaster({
      sourceLang: 'zh-Hans',
      targetLang: 'en',
      files: ['common.json'],
      force: true,
    });

    expect(forced).toMatchObject({ totalFiles: 1, successFiles: 1, totalUpdated: 1, totalSkipped: 1 });
    expect(await readJson(path.join(localesDir, 'en/common.json'))).toEqual({
      title: 'zh-Hans->en:你好',
      extra: 'Keep me',
    });
    await expect(fs.access(path.join(tempDir, 'cache.snapshot.json'))).rejects.toThrow();
    await expect(translator.translateMaster({
      sourceLang: 'zh-Hans',
      targetLang: 'ja',
      files: ['common.json'],
    })).rejects.toThrow('Target language must be a configured master');
  });

  it('preserves a target when reassigned and uses the new master for later diffs', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-reassign-'));
    const localesDir = path.join(tempDir, 'locales');
    const cachePath = path.join(tempDir, 'cache.json');
    await writeJson(path.join(localesDir, 'en/common.json'), { title: 'Open' });
    await writeJson(path.join(localesDir, 'zh-CN/common.json'), { title: '打开' });

    const createWithFakeLLM = async (sourceLang: 'en' | 'zh-CN') => {
      const translator = new Translator({
        routes: [{ sourceLang, targetLangs: ['ja'] }],
        baseLang: sourceLang,
        targetLangs: ['ja'],
        localesDir,
        skipKeys: [],
        llm: { apiKey: 'test-key', model: 'test-model' },
        cachePath,
      });
      await translator.initialize();
      const translateBatch = vi.fn(async (tasks: TranslationTask[]): Promise<TranslationResult[]> =>
        tasks.map(task => ({
          key: task.key,
          translatedText: `${task.sourceLang}->${task.targetLang}:${task.sourceText}`,
          targetLang: task.targetLang,
          success: true,
        }))
      );
      (translator as unknown as { llmClient: { translateBatch: typeof translateBatch } }).llmClient = { translateBatch };
      return { translator, translateBatch };
    };

    const englishRun = await createWithFakeLLM('en');
    await englishRun.translator.translateAll();
    expect((await readJson(path.join(localesDir, 'ja/common.json'))).title).toBe('en->ja:Open');

    const chineseRun = await createWithFakeLLM('zh-CN');
    await chineseRun.translator.translateAll();
    expect(chineseRun.translateBatch).not.toHaveBeenCalled();
    expect((await readJson(path.join(localesDir, 'ja/common.json'))).title).toBe('en->ja:Open');

    await writeJson(path.join(localesDir, 'zh-CN/common.json'), { title: '立即打开' });
    chineseRun.translateBatch.mockClear();
    await chineseRun.translator.translateAll();
    expect(chineseRun.translateBatch).toHaveBeenCalled();
    expect((await readJson(path.join(localesDir, 'ja/common.json'))).title).toBe('zh-CN->ja:立即打开');
  });

  it('supports programmatic single-master config and syncs skip-only files', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-single-master-'));
    const localesDir = path.join(tempDir, 'locales');
    await writeJson(path.join(localesDir, 'en/brand.json'), { brand: 'ACME' });
    await writeJson(path.join(localesDir, 'en/common.json'), { title: 'Open' });

    // routes 故意省略，验证公开的程序化单母版 API 仍兼容。
    const translator = createTranslator({
      baseLang: 'en',
      targetLangs: ['de'],
      localesDir,
      skipKeys: ['brand'],
      llm: { apiKey: 'test-key' },
      cachePath: path.join(tempDir, 'cache.json'),
    });
    await translator.initialize();
    const translateBatch = vi.fn(async (tasks: TranslationTask[]): Promise<TranslationResult[]> =>
      tasks.map(task => ({
        key: task.key,
        translatedText: `${task.sourceLang}->${task.targetLang}:${task.sourceText}`,
        targetLang: task.targetLang,
        success: true,
      }))
    );
    (translator as unknown as { llmClient: { translateBatch: typeof translateBatch } }).llmClient = { translateBatch };

    await translator.translateAll();
    expect(await readJson(path.join(localesDir, 'de/brand.json'))).toEqual({ brand: 'ACME' });
    expect((await readJson(path.join(localesDir, 'de/common.json'))).title).toBe('en->de:Open');
    expect(translateBatch.mock.calls.flatMap(call => call[0]).every(task => task.sourceLang === 'en')).toBe(true);

    await writeJson(path.join(localesDir, 'en/brand.json'), { brand: 'ACME 2' });
    translateBatch.mockClear();
    await translator.translateAll();
    expect(await readJson(path.join(localesDir, 'de/brand.json'))).toEqual({ brand: 'ACME 2' });
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('fails before translating when any master directory is missing', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-missing-master-'));
    const localesDir = path.join(tempDir, 'locales');
    await writeJson(path.join(localesDir, 'en/common.json'), { title: 'Open' });
    const translator = new Translator({
      routes: [
        { sourceLang: 'en', targetLangs: ['de'] },
        { sourceLang: 'zh-CN', targetLangs: ['ja'] },
      ],
      baseLang: 'en',
      targetLangs: ['de', 'ja'],
      localesDir,
      skipKeys: [],
      llm: { apiKey: 'test-key' },
      cachePath: path.join(tempDir, 'cache.json'),
    });
    await translator.initialize();

    await expect(translator.translateAll()).rejects.toThrow('Failed to scan master directory zh-CN');
    await expect(fs.access(path.join(localesDir, 'de/common.json'))).rejects.toThrow();
  });

  it('removes stale keys incrementally and retranslates existing keys in force mode', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-force-'));
    const localesDir = path.join(tempDir, 'locales');
    await writeJson(path.join(localesDir, 'en/common.json'), {
      title: 'Open',
      action: 'Continue',
    });
    await writeJson(path.join(localesDir, 'de/common.json'), {
      title: 'Öffnen',
      action: 'Weiter',
      stale: 'Entfernen',
    });

    const translator = new Translator({
      routes: [{ sourceLang: 'en', targetLangs: ['de'] }],
      baseLang: 'en',
      targetLangs: ['de'],
      localesDir,
      skipKeys: [],
      llm: { apiKey: 'test-key', model: 'test-model' },
      cachePath: path.join(tempDir, 'cache.json'),
    });
    await translator.initialize();
    const translateBatch = vi.fn(async (tasks: TranslationTask[]): Promise<TranslationResult[]> =>
      tasks.map(task => ({
        key: task.key,
        translatedText: `forced:${task.sourceText}`,
        targetLang: task.targetLang,
        success: true,
      }))
    );
    (translator as unknown as { llmClient: { translateBatch: typeof translateBatch } }).llmClient = { translateBatch };

    await translator.translateAll();
    expect(translateBatch).not.toHaveBeenCalled();
    expect(await readJson(path.join(localesDir, 'de/common.json'))).toEqual({
      title: 'Öffnen',
      action: 'Weiter',
    });

    translator.setForce(true);
    await translator.translateAll();
    expect(translateBatch).toHaveBeenCalled();
    expect(await readJson(path.join(localesDir, 'de/common.json'))).toEqual({
      title: 'forced:Open',
      action: 'forced:Continue',
    });
  });

  it('reports failed LLM keys as a failed file instead of a successful run', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-failure-'));
    const localesDir = path.join(tempDir, 'locales');
    await writeJson(path.join(localesDir, 'en/common.json'), { title: 'Open' });

    const translator = new Translator({
      baseLang: 'en',
      targetLangs: ['de'],
      localesDir,
      skipKeys: [],
      llm: { apiKey: 'test-key' },
      cachePath: path.join(tempDir, 'cache.json'),
    });
    await translator.initialize();
    (translator as unknown as { failureLogger: FailureLogger }).failureLogger = new FailureLogger(
      path.join(tempDir, 'failures.json'),
    );
    const translateBatch = vi.fn(async (tasks: TranslationTask[]): Promise<TranslationResult[]> =>
      tasks.map(task => ({
        key: task.key,
        translatedText: '',
        targetLang: task.targetLang,
        success: false,
        error: 'LLM unavailable',
      }))
    );
    (translator as unknown as { llmClient: { translateBatch: typeof translateBatch } }).llmClient = { translateBatch };

    const stats = await translator.translateAll();

    expect(stats.successFiles).toBe(0);
    expect(stats.failedFiles).toBe(1);
    expect(await readJson(path.join(localesDir, 'de/common.json'))).toEqual({ title: 'Open' });
  });

  it('keeps translator snapshot contexts isolated after another translator initializes', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-ai-diff-translator-isolation-'));
    const projectA = path.join(tempDir, 'project-a');
    const projectB = path.join(tempDir, 'project-b');
    const localesA = path.join(projectA, 'locales');
    const localesB = path.join(projectB, 'locales');

    await Promise.all([
      writeJson(path.join(localesA, 'en/common.json'), { title: 'Open now' }),
      writeJson(path.join(localesA, 'de/common.json'), { title: 'Öffnen' }),
      writeJson(path.join(localesB, 'en/common.json'), { title: 'Open now' }),
      writeJson(path.join(localesB, 'de/common.json'), { title: 'Öffnen' }),
      writeJson(path.join(projectA, 'cache.snapshot.json'), {
        version: 3,
        entries: {
          'en:de:common.json': { '/title': sourceTextHash('Open') },
        },
        owners: {
          'de:common.json': 'en',
        },
      }),
    ]);

    const translatorA = new Translator({
      baseLang: 'en',
      targetLangs: ['de'],
      localesDir: localesA,
      skipKeys: [],
      llm: { apiKey: 'test-key', model: 'test-model' },
      cachePath: path.join(projectA, 'cache.json'),
    });
    const translatorB = new Translator({
      baseLang: 'en',
      targetLangs: ['de'],
      localesDir: localesB,
      skipKeys: [],
      llm: { apiKey: 'test-key', model: 'test-model' },
      cachePath: path.join(projectB, 'cache.json'),
    });

    await translatorA.initialize();
    await translatorB.initialize();

    const translateBatch = vi.fn(async (tasks: TranslationTask[]): Promise<TranslationResult[]> =>
      tasks.map(task => ({
        key: task.key,
        translatedText: `fresh:${task.sourceText}`,
        targetLang: task.targetLang,
        success: true,
      }))
    );
    (translatorA as unknown as { llmClient: { translateBatch: typeof translateBatch } }).llmClient = { translateBatch };

    await translatorA.translateAll();

    expect(translateBatch).toHaveBeenCalledOnce();
    expect(translateBatch.mock.calls.flatMap(call => call[0]).map(task => task.key)).toEqual(['/title']);
    expect(await readJson(path.join(localesA, 'de/common.json'))).toEqual({ title: 'fresh:Open now' });
    expect(await readJson(path.join(localesB, 'de/common.json'))).toEqual({ title: 'Öffnen' });
  });
});
