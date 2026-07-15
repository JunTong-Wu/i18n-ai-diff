import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import type { TranslateConfig } from '../../src/types/index.js';
import type { Translator } from '../../src/core/translator.js';

const watcherMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const watcher = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return watcher;
    }),
    close: vi.fn(async () => undefined),
  };
  return {
    handlers,
    watcher,
    watch: vi.fn(() => watcher),
  };
});

vi.mock('chokidar', () => ({
  default: { watch: watcherMock.watch },
}));

import { FileWatcher } from '../../src/core/file-watcher.js';

describe('multi-master file watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    watcherMock.handlers.clear();
    watcherMock.watch.mockClear();
    watcherMock.watcher.on.mockClear();
    vi.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('watches every master and dispatches changes only to its targets', async () => {
    const localesDir = path.resolve('/tmp/i18n-ai-diff-watcher/locales');
    const config: TranslateConfig = {
      routes: [
        { baseLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
        { baseLang: 'en', targetLangs: ['de', 'fr'] },
      ],
      baseLang: 'zh-CN',
      targetLangs: ['ja', 'ko', 'de', 'fr'],
      localesDir,
      skipKeys: [],
      llm: { apiKey: 'test-key' },
      watch: { enabled: true, debounceMs: 5 },
    };
    const translator = {
      translateFile: vi.fn(async () => ({ success: true })),
      removeTargetFile: vi.fn(async () => undefined),
      saveCache: vi.fn(async () => undefined),
    } as unknown as Translator;
    const fileWatcher = new FileWatcher(config, translator);

    await fileWatcher.start();
    expect(watcherMock.watch).toHaveBeenCalledWith(
      [path.join(localesDir, 'zh-CN'), path.join(localesDir, 'en')],
      expect.any(Object),
    );

    watcherMock.handlers.get('change')?.(path.join(localesDir, 'en/pages/home.json'));
    await vi.advanceTimersByTimeAsync(5);

    const translateFile = (translator as unknown as { translateFile: ReturnType<typeof vi.fn> }).translateFile;
    expect(translateFile).toHaveBeenCalledTimes(2);
    expect(translateFile).toHaveBeenCalledWith('pages/home.json', 'de', undefined, undefined, 'en');
    expect(translateFile).toHaveBeenCalledWith('pages/home.json', 'fr', undefined, undefined, 'en');
    expect(translateFile).not.toHaveBeenCalledWith(
      expect.anything(),
      'ja',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    watcherMock.handlers.get('unlink')?.(path.join(localesDir, 'zh-CN/common.json'));
    await vi.advanceTimersByTimeAsync(5);

    const removeTargetFile = (translator as unknown as { removeTargetFile: ReturnType<typeof vi.fn> }).removeTargetFile;
    expect(removeTargetFile).toHaveBeenCalledWith('common.json', 'ja');
    expect(removeTargetFile).toHaveBeenCalledWith('common.json', 'ko');
  });

  it('serializes overlapping change batches', async () => {
    const localesDir = path.resolve('/tmp/i18n-ai-diff-watcher-serial/locales');
    const config: TranslateConfig = {
      baseLang: 'en',
      targetLangs: ['de'],
      localesDir,
      skipKeys: [],
      llm: { apiKey: 'test-key' },
      watch: { enabled: true, debounceMs: 5 },
    };
    let releaseFirst!: () => void;
    const firstCall = new Promise<void>(resolve => { releaseFirst = resolve; });
    let active = 0;
    let maxActive = 0;
    let callCount = 0;
    const translator = {
      translateFile: vi.fn(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        callCount++;
        if (callCount === 1) await firstCall;
        active--;
        return { success: true };
      }),
      removeTargetFile: vi.fn(async () => undefined),
      saveCache: vi.fn(async () => undefined),
    } as unknown as Translator;
    const fileWatcher = new FileWatcher(config, translator);
    await fileWatcher.start();

    const changedFile = path.join(localesDir, 'en/common.json');
    watcherMock.handlers.get('change')?.(changedFile);
    await vi.advanceTimersByTimeAsync(5);
    watcherMock.handlers.get('change')?.(changedFile);
    await vi.advanceTimersByTimeAsync(5);

    expect(maxActive).toBe(1);
    releaseFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(maxActive).toBe(1);
    expect((translator as unknown as { translateFile: ReturnType<typeof vi.fn> }).translateFile).toHaveBeenCalledTimes(2);
  });

  it('continues with sibling targets after one target fails', async () => {
    const localesDir = path.resolve('/tmp/i18n-ai-diff-watcher-failure/locales');
    const config: TranslateConfig = {
      baseLang: 'en',
      targetLangs: ['de', 'fr'],
      localesDir,
      skipKeys: [],
      llm: { apiKey: 'test-key' },
      watch: { enabled: true, debounceMs: 5 },
    };
    const translator = {
      translateFile: vi.fn(async (_file, targetLang) => ({
        success: targetLang !== 'de',
        error: targetLang === 'de' ? 'LLM unavailable' : undefined,
      })),
      removeTargetFile: vi.fn(async () => undefined),
      saveCache: vi.fn(async () => undefined),
    } as unknown as Translator;
    const fileWatcher = new FileWatcher(config, translator);
    await fileWatcher.start();

    watcherMock.handlers.get('change')?.(path.join(localesDir, 'en/common.json'));
    await vi.advanceTimersByTimeAsync(5);

    const translateFile = (translator as unknown as { translateFile: ReturnType<typeof vi.fn> }).translateFile;
    expect(translateFile).toHaveBeenCalledTimes(2);
    expect(translateFile).toHaveBeenCalledWith('common.json', 'de', undefined, undefined, 'en');
    expect(translateFile).toHaveBeenCalledWith('common.json', 'fr', undefined, undefined, 'en');
    expect((translator as unknown as { saveCache: ReturnType<typeof vi.fn> }).saveCache).toHaveBeenCalledOnce();
  });
});
