import { describe, expect, it } from 'vitest';
import {
  buildTranslationRunCommand,
  normalizeTranslationRunRequest,
} from '../../src/core/translation-runner.js';
import type { ResolvedTranslateConfig } from '../../src/types/index.js';

describe('translation shortcut runner', () => {
  it('builds CLI-equivalent commands for panel shortcut modes', () => {
    expect(buildTranslationRunCommand({ mode: 'pending' })).toBe('i18n-ai-diff');
    expect(buildTranslationRunCommand({ mode: 'pending', targetLangs: ['fr', 'ja'] })).toBe('i18n-ai-diff -l fr ja');
    expect(buildTranslationRunCommand({ mode: 'force', targetLangs: ['fr'] })).toBe('i18n-ai-diff -f -l fr');
    expect(buildTranslationRunCommand({
      mode: 'master-to-master',
      masterToMaster: { sourceLang: 'zh-Hans', targetLang: 'en', force: true },
    })).toBe('i18n-ai-diff translate-master --from zh-Hans --to en -f');
  });

  it('keeps panel language-scoped runs inside configured target languages', () => {
    const config = createConfig();
    expect(normalizeTranslationRunRequest(config, {
      mode: 'pending',
      targetLangs: ['ja', 'fr', 'ja'],
    })).toEqual({
      mode: 'pending',
      targetLangs: ['ja', 'fr'],
    });

    expect(() => normalizeTranslationRunRequest(config, {
      mode: 'pending',
      targetLangs: ['it'],
    })).toThrow('Target languages are not configured: it');
  });

  it('allows master-to-master only between configured master languages', () => {
    const config = createConfig();
    expect(normalizeTranslationRunRequest(config, {
      mode: 'master-to-master',
      masterToMaster: { sourceLang: 'zh-Hans', targetLang: 'en' },
    })).toEqual({
      mode: 'master-to-master',
      masterToMaster: { sourceLang: 'zh-Hans', targetLang: 'en' },
    });

    expect(() => normalizeTranslationRunRequest(config, {
      mode: 'master-to-master',
      masterToMaster: { sourceLang: 'ja', targetLang: 'en' },
    })).toThrow('Source language must be a configured master: ja');
  });
});

function createConfig(): ResolvedTranslateConfig {
  return {
    baseLang: 'zh-Hans',
    targetLangs: ['ja', 'ko', 'fr'],
    localesDir: '/tmp/locales',
    skipKeys: [],
    llm: { apiKey: 'test', model: 'test-model' },
    routes: [
      { sourceLang: 'zh-Hans', targetLangs: ['ja', 'ko'] },
      { sourceLang: 'en', targetLangs: ['fr'] },
    ],
  };
}
