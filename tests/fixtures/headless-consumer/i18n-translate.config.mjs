import { defineConfig } from 'i18n-ai-diff';

export default defineConfig({
  routes: [
    {
      sourceLang: 'zh-Hans',
      targetLangs: ['ja', 'ko'],
    },
    {
      sourceLang: 'en',
      targetLangs: ['de', 'es', 'fr', 'it', 'pt'],
    },
  ],
  localesDir: './locales',
  skipKeys: ['methods.grid.*.value_global', 'methods.grid.*.value_JP'],
  llm: {
    apiKey: process.env.I18N_TEST_API_KEY || 'fixture-only-key',
    model: process.env.I18N_TEST_MODEL || 'gpt-4o-mini',
    baseURL: process.env.I18N_TEST_BASE_URL
      || 'http://127.0.0.1:9/v1',
    maxTokens: 4096,
    temperature: 0.3,
    timeout: 500,
    retries: 1,
  },
  prompt: `
"DWARF" and "DWARFLAB" are brand names and must NOT be translated.
Product model names must stay consistent and not be paraphrased.
The domain is astrophotography — use terminology and tone appropriate for that field.
Keep translation quality natural and native-level; avoid literal machine translation.
Do not mix languages in one string.
`,
  concurrency: 5,
  batchSize: 20,
  cachePath: './.i18n-translate-cache.json',
});
