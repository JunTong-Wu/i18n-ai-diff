# Real consumer testing

The real-consumer harness verifies the package across the same boundary as an npm user:

1. Build the current source.
2. Create the exact `npm pack` tarball.
3. Create a clean project outside the package source tree.
4. Install the tarball into that project.
5. Copy a pinned nine-language fixture captured from `headless-global-site`.
6. Run the installed binary, not `src/bin/cli.ts` or the repository's `dist` path.
7. Start the installed local panel and verify its HTML, security headers, health endpoint, and project scan.

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
- does not create a failure log.
- serves the packaged Web panel on `127.0.0.1` with all 259 tasks visible.

The generated workspace is deliberately kept at the printed operating-system temporary path for inspection. It is physically outside the package repository, preventing Node.js from resolving undeclared dependencies from the repository's `node_modules`.

## Manual acceptance workspace

Prepare a fresh workspace without running translation:

```bash
npm run consumer:prepare
cd "$(node -p 'require("node:os").tmpdir()')/i18n-ai-diff-consumer"
npm run translate
npm run panel
```

The workspace always installs the local tarball. It never imports the package through a symlink, so missing publish files, broken exports, and dependency mistakes remain visible.

The panel command runs from this same directory. This ensures the browser exercises the packaged panel and the realistic nine-language project rather than development source files.

Set `I18N_CONSUMER_DIR` to place the generated project at a stable custom location:

```bash
I18N_CONSUMER_DIR=/tmp/i18n-consumer npm run consumer:prepare
```

The fixture contains translation JSON, a version 2 empty cache, and a version 3 source snapshot. It contains no API key or application source code. Its provenance is recorded in `tests/fixtures/headless-consumer/fixture-manifest.json`.

The fixture deliberately ignores normal `OPENAI_*` environment variables. Its default LLM endpoint is unreachable, and automated verification replaces it with a local request trap. This makes an unexpected translation attempt fail visibly without spending API credits or sending business text over the network.
