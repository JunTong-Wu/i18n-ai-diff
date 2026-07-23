# CLI contract

## Public commands

### `i18n-ai-diff`

Default command: scan configured locale JSON files, translate only eligible changed/missing target copy, update target files, cache, and snapshots according to core translator semantics.

Options:

- `-c, --config <path>`: use an explicit config file.
- `-w, --watch`: after the initial run, watch configured master/source directories and translate future source changes.
- `-f, --force`: force retranslate all non-skipped eligible keys. This is an explicit refresh operation, not normal incremental mode.
- `-l, --langs <langs...>`: target language filter for this run only.
- `--verbose`: enable verbose logging.
- `-v, --version`: print package version.

Language filtering:

- Single-master mode may temporarily replace the configured target language list with requested `--langs`, except the master language itself is invalid as a target.
- Multi-master mode may only select already configured target languages. Preserve each selected target's route owner and drop empty routes.
- `--langs` never writes config.

### `i18n-ai-diff translate-master`

One-time helper for translating from one configured master/source language into another configured master/source language.

Options:

- `--from <sourceLang>`: required configured master language.
- `--to <targetLang>`: required configured master language.
- `--file <paths...>`: optional project-relative JSON file limit.
- `-c, --config <path>`: use an explicit config file.
- `-f, --force`: overwrite existing target-master copy and ignore cache.
- `--verbose`: enable verbose logging.

Rules:

- Allow only in multi-master mode.
- Require both endpoints to be configured `routes[].sourceLang` values and different from each other.
- Keep this separate from normal target-language route ownership. It must not create target routes.
- Default behavior preserves reviewed target-master copy; `--force` is the explicit overwrite path.

### `i18n-ai-diff panel`

Start the packaged local panel from the current project.

Options:

- `-c, --config <path>`: use an explicit config file.
- `-p, --port <port>`: local loopback port. `0` is valid and means "ask the OS for an available port".
- `--no-open`: start without opening the browser.

Rules:

- Bind the packaged panel to loopback by default.
- The panel can save, translate, and run shortcuts by default.
- Print the actual panel URL after startup, especially when `--port 0` is used.
- Preserve Host, Origin, session token, body-size, path-safety, and revision write boundaries owned by backend/server code.

## Dev-only scripts

`npm run panel:dev` is for local development, not the public npm CLI.

Current behavior:

- Starts the API process from `playground/consumer`.
- Starts the Vite panel from source.
- Defaults to `PANEL_DEV_PORT=4187` for Vite and `PANEL_API_PORT=4188` for API.
- Supports `PANEL_DEV_PROJECT_DIR` to point at another real app.
- Loads `playground/consumer/.env` or the selected project's `.env` for real LLM debugging.

Do not document dev-only behavior as public CLI unless the user explicitly wants it exposed.

## Config and terminology

- Public docs use "single-master mode" / "multi-master mode" in English and `单母版模式` / `多母版模式` in Simplified Chinese.
- New multi-master config examples use `routes: [{ sourceLang, targetLangs }]`.
- Legacy `routes[].baseLang` remains compatibility-only; do not present it as new public config.
- Do not expose or serialize `watch.enabled`. Watch mode is a command flag; config `watch` only tunes behavior once watch mode is requested.

## Cache, snapshot, and write semantics

- Normal CLI runs are incremental and preserve reviewed target translations unless their source snapshot indicates a pending change.
- `--force` is the explicit user signal to refresh/retranslate.
- `--force --langs <targets...>` refreshes only the selected target-language scope. It must not clear or invalidate cache entries for unselected target languages.
- Normal incremental runs must not prune old cache entries just because the current master no longer references their source text.
- Cache entries are isolated by `sourceLang + sourceText + targetLang`.
- Snapshot ownership uses `sourceLang`; single-master mode must not reintroduce a separate internal `baseLang` path.
- `skipKeys` applies to AI translation flows. CLI and panel AI translation should not generate LLM output for skipped keys.
- Manual table editing may write skipped-key values, but that is panel editor behavior, not CLI AI behavior.

## Panel CLI shortcut parity

The CLI shortcut page is a browser UI for direct-write CLI-equivalent operations.

- Pending mode maps to `i18n-ai-diff` with optional `-l`.
- Force mode maps to `i18n-ai-diff -f` with optional `-l`.
- Master-to-master mode maps to `i18n-ai-diff translate-master --from ... --to ...` plus optional `-f` and `--file`.
- Panel execution writes files/cache/snapshots immediately after confirmation; it does not create table-editor drafts.

## Documentation expectations

When public CLI behavior changes:

- Update both `README.md` and `README_zh.md`.
- Keep examples copy/pasteable.
- Explain whether a command writes locale JSON, cache, snapshots, config, or browser-only draft state.
- Keep the order friendly to new users: directory layout, first config, single/multi-master concepts, then commands.

## Validation map

- Option parsing or command generation: `tests/core/translation-runner.test.ts`, CLI-related focused tests, and `npm test -- --run`.
- Route filtering: `tests/core/route-selector.test.ts`.
- Watch behavior: `tests/core/file-watcher.routes.test.ts`.
- Panel server `--port` and write boundary: `tests/panel/server.test.ts`.
- Real package behavior: `npm run test:package`.
- Installed package behavior: `npm run test:install`.
- Embedded real consumer behavior: `npm run test:consumer`.
- Release confidence: `npm run test:release`.
