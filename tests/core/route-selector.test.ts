import { describe, expect, it } from 'vitest';
import { selectTargetLanguages } from '../../src/core/route-selector.js';
import type { ResolvedTranslateConfig } from '../../src/types/index.js';

function createConfig(routes: ResolvedTranslateConfig['routes']): ResolvedTranslateConfig {
  return {
    routes: routes.map(route => ({ ...route, targetLangs: [...route.targetLangs] })),
    baseLang: routes[0].baseLang,
    targetLangs: routes.flatMap(route => route.targetLangs),
    localesDir: '/tmp/locales',
    skipKeys: [],
    llm: { apiKey: 'test-key' },
  };
}

describe('CLI target-language selection', () => {
  it('preserves master routes while filtering multi-master targets', () => {
    const config = createConfig([
      { baseLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
      { baseLang: 'en', targetLangs: ['de', 'it', 'fr', 'es'] },
    ]);

    selectTargetLanguages(config, ['fr', 'ja', 'ko', 'ja']);

    expect(config.routes).toEqual([
      { baseLang: 'zh-CN', targetLangs: ['ja', 'ko'] },
      { baseLang: 'en', targetLangs: ['fr'] },
    ]);
    expect(config.targetLangs).toEqual(['ja', 'ko', 'fr']);
  });

  it('rejects unconfigured targets in multi-master mode', () => {
    const config = createConfig([
      { baseLang: 'zh-CN', targetLangs: ['ja'] },
      { baseLang: 'en', targetLangs: ['fr'] },
    ]);

    expect(() => selectTargetLanguages(config, ['ja', 'pt'])).toThrow(
      'Target languages are not configured in any master route: pt'
    );
  });

  it('allows temporary target overrides in single-master mode', () => {
    const config = createConfig([{ baseLang: 'en', targetLangs: ['de'] }]);

    selectTargetLanguages(config, ['fr', 'ja', 'fr']);

    expect(config.routes[0].targetLangs).toEqual(['fr', 'ja']);
    expect(config.targetLangs).toEqual(['fr', 'ja']);
  });

  it('rejects selecting the master as a target', () => {
    const config = createConfig([{ baseLang: 'en', targetLangs: ['de'] }]);
    expect(() => selectTargetLanguages(config, ['en'])).toThrow(
      'Target languages must not contain the master language: en'
    );
  });
});
