# i18n-ai-diff

[中文](./README_zh.md) | **English**

Frontend projects with i18n typically maintain a set of JSON files in English as the base language. Translating them into other languages requires manual work or outsourcing — expensive, slow, and error-prone.

`i18n-ai-diff` automates this with LLM: it watches your English source files, precisely detects which keys are added, modified, or deleted, and only calls the translation API for the changes. Results are written back to the corresponding language JSON files. Translation cache + source file snapshots ensure zero overhead on repeated runs. The `skipKeys` config preserves brand names and other fields that should remain untranslated. Compatible with any OpenAI-compatible API service.

## Install

```bash
npm install i18n-ai-diff
```

## Translate

Scans the base language directory, diffs against target language files, and only translates added or modified keys. Zero API calls when nothing has changed.

```bash
npx i18n-ai-diff
```

## Translate + Watch

Runs a full translation first, then continuously watches for base language file changes and auto-syncs translations to all target languages. Ideal for development. `Ctrl+C` to exit.

```bash
npx i18n-ai-diff -w
```

## Force Full Retranslation

Clears cache and snapshots, ignores existing translations, and retranslates all keys via LLM. Use when switching models or when a full quality refresh is needed.

```bash
npx i18n-ai-diff -f
```

## Specify Languages

Overrides `targetLangs` from the config file. Only translates the specified languages. Accepts multiple BCP 47 language codes.

```bash
npx i18n-ai-diff -l fr ja ko
```

## Configuration

Create `i18n-translate.config.ts`:

```typescript
import { defineConfig } from 'i18n-ai-diff';

export default defineConfig({
  baseLang: 'en',
  targetLangs: ['zh', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru'],
  localesDir: './src/i18n/messages',

  skipKeys: [
    'common.brandName',
    'footer.**',
  ],

  llm: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
    baseURL: 'https://api.openai.com/v1',
    maxTokens: 4096,
    temperature: 0.3,
    timeout: 30000,
    retries: 3,
  },

  concurrency: 5,
  batchSize: 20,
  cachePath: '.i18n-translate-cache.json',
});
```

Other options:

```bash
npx i18n-ai-diff -c ./path/to/config.ts   # Custom config file
npx i18n-ai-diff --verbose                 # Verbose logging
```

## Directory Structure

```
locales/
├── en/           # Base language
│   ├── common.json
│   └── pages/
│       └── home.json
├── de/           # Target language (auto-translated)
│   └── ...
└── ja/
    └── ...
```

## How It Works

- Detects changes in `en` via source file snapshots — only translates added and modified keys
- Deleted keys are automatically removed from target language files
- Translation results are cached — identical text is never sent to the API twice
- Compatible with any OpenAI-standard API

## Troubleshooting

### `Batch translation failed: Translation failed after N retries: Request was aborted.`

The request did not complete within the timeout and was aborted. Troubleshoot in order:

1. **Check your network proxy/VPN** — make sure the proxy is active and the current region can reach your LLM service (e.g. OpenAI requires a non-restricted region, while Tencent HunYuan has poor connectivity in overseas nodes)
2. LLM service is slow or unstable
3. `timeout` is too low (default 30000ms)
4. `batchSize` is too large, sending too much text per request

Adjust config:

```typescript
llm: {
  timeout: 60000,   // Increase timeout (ms)
  retries: 5,       // More retry attempts
},
batchSize: 10,      // Smaller batch size
concurrency: 3,     // Lower concurrency
```

### `LLM returned empty content`

The LLM returned an empty response. Usually caused by rate limiting or prompt being too long. Reduce `batchSize` or switch to a more stable model.

### `Config file not found`

No config file was found. Make sure `i18n-translate.config.ts` exists in the project root, or specify a path with `-c`.

### `llm.apiKey is required`

API key is not configured. Set `llm.apiKey` in the config file, or set the `OPENAI_API_KEY` environment variable.

### `Cache version mismatch, resetting`

The cache file version doesn't match (usually after an upgrade). The cache resets automatically. The first run will retranslate all keys; subsequent runs resume incremental mode.

### `N keys failed, see .i18n-translate-failures.md`

Some keys failed to translate. Check `.i18n-translate-failures.md` in the project root for details. Run `npx i18n-ai-diff` again to automatically retry the failed keys.

## License

MIT
