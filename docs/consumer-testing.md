# Real consumer testing

The real-consumer harness verifies the package across the same boundary as an npm user:

1. Build the current source.
2. Create the exact `npm pack` tarball.
3. Create a clean project outside the package source tree.
4. Install the tarball into that project.
5. Copy the checked-in nine-language playground consumer captured from `headless-global-site`.
6. Run the installed binary, not `src/bin/cli.ts` or the repository's `dist` path.
7. Start the installed local panel and verify its HTML, security headers, health endpoint, project scan, and nine-language editor manifest.

## Automated acceptance

Run the complete pre-release suite:

```bash
npm run test:release
```

Run only the real-consumer acceptance:

```bash
npm run test:consumer
```

This test asserts that a normal incremental run:

- detects both translation routes;
- processes all 259 source/target file pairs;
- makes no network request to an LLM;
- does not add, remove, or alter any reviewed locale JSON file;
- does not change the cache or source snapshot;
- does not create a failure log;
- serves the packaged Web panel on `127.0.0.1` with all 259 tasks visible;
- loads 37 logical JSON files and nine language revisions through the read-only editor API;
- rejects editor writes unless the installed panel was explicitly started with `--edit`.

The generated workspace is deliberately kept at the printed operating-system temporary path for inspection. It is physically outside the package repository, preventing Node.js from resolving undeclared dependencies from the repository's `node_modules`.

## Daily panel development

For normal UI and real-LLM debugging, use the checked-in playground consumer directly:

```bash
nano playground/consumer/.env
npm run panel:dev
```

`npm run panel:dev` starts the API from `playground/consumer` and the Vite panel from the package source. It does not create or copy a temp project. Manual saves from the development panel write to the single `playground/consumer/locales` directory. The consumer config loads `playground/consumer/.env` automatically; shell environment variables still take precedence when both are set.

The playground consumer is intentionally real enough to debug daily behavior:

- `playground/consumer/i18n-translate.config.mjs` contains the multi-master routes.
- `playground/consumer/locales` contains the nine-language locale files.
- `playground/consumer/state` contains the cache and source snapshot used by the panel.
- `playground/consumer/package.json` can be installed as a standalone local consumer through `file:../..` when you want to check the package boundary manually.

If you need to point the panel at a different real app, override the project directory:

```bash
PANEL_DEV_PROJECT_DIR=/absolute/path/to/your/app npm run panel:dev
```

## Packaged consumer acceptance workspace

Prepare a fresh workspace without running translation:

```bash
npm run consumer:prepare
cd "$(node -p 'require("node:os").tmpdir()')/i18n-ai-diff-consumer"
npm run translate
npm run panel
npm run panel -- --edit  # Restart this way for manual save acceptance
```

The workspace always installs the local tarball. It never imports the package through a symlink, so missing publish files, broken exports, and dependency mistakes remain visible.

The panel command runs from this same directory. This ensures the browser exercises the packaged panel and the realistic nine-language project rather than development source files.

Set `I18N_CONSUMER_DIR` to place the generated project at a stable custom location:

```bash
I18N_CONSUMER_DIR=/tmp/i18n-consumer npm run consumer:prepare
```

The playground consumer contains translation JSON, a version 2 empty cache at `state/cache.json`, and a version 3 source snapshot at `state/cache.snapshot.json`. It contains no API key or application source code. Its provenance is recorded in `playground/consumer/fixture-manifest.json`.

The playground consumer reads real `OPENAI_*` variables for manual debugging. Automated verification can still override them with `I18N_TEST_*` variables when a test needs a controlled local request trap.
