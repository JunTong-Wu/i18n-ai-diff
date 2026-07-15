import { describe, expect, it } from 'vitest';
import { buildBatchPrompt } from '../../src/llm/prompt-builder.js';

describe('multi-master batch prompt', () => {
  it('tells the model both source and target languages', () => {
    const { prompt } = buildBatchPrompt([{
      key: 'common.open',
      sourceText: '打开',
      sourceLang: 'zh-CN',
      targetLang: 'ja',
      filePath: 'common.json',
    }]);

    expect(prompt).toContain('Source language BCP 47 tag: "zh-CN"');
    expect(prompt).toContain('Target language BCP 47 tag: "ja"');
  });
});
