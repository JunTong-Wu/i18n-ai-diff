import fs from 'node:fs';
import { defineConfig } from 'i18n-ai-diff';

loadLocalEnv(new URL('.env', import.meta.url));

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
    apiKey: process.env.I18N_TEST_API_KEY
      || process.env.OPENAI_API_KEY
      || 'fixture-only-key',
    model: process.env.I18N_TEST_MODEL
      || process.env.OPENAI_MODEL
      || 'gpt-4o-mini',
    baseURL: process.env.I18N_TEST_BASE_URL
      || process.env.OPENAI_BASE_URL,
    maxTokens: 4096,
    temperature: 0.3,
    timeout: Number(process.env.I18N_TEST_TIMEOUT || process.env.OPENAI_TIMEOUT || 60000),
    retries: Number(process.env.I18N_TEST_RETRIES || process.env.OPENAI_RETRIES || 3),
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
  cachePath: './state/cache.json',
});

function loadLocalEnv(envUrl) {
  let content = '';
  try {
    content = fs.readFileSync(envUrl, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(rawValue) {
  let value = rawValue.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, '').trim();
  }

  return value;
}
