# Backend constraints

## Layer ownership

- `src/types/index.ts` owns public and internal TypeScript contracts for config, translation tasks, project scan data, editor rows, and save requests. Avoid duplicating shape definitions in server or UI code.
- `src/core/config-loader.ts` owns config discovery, default merging, path resolution, validation, and route normalization.
- `src/core/route-selector.ts`, `src/core/diff-analyzer.ts`, `src/core/translator.ts`, `src/core/file-watcher.ts`, and `src/core/project-inspector.ts` own translation semantics. Keep them free of HTTP and browser concerns.
- `src/core/translation-runner.ts` owns panel-triggered CLI shortcut execution: pending translation, force refresh, language-scoped runs, and one-time master-to-master runs. It must reuse the same translator and route-selector semantics as the CLI.
- `src/core/settings-service.ts` owns panel-triggered visual config reads and writes for `i18n-translate.config.*`: current config projection, AST/range-based managed-field patching, validation, revision checks, and atomic replacement. It must never expose or write API keys, and must not replace the full user-owned config module.
- `src/core/project-session.ts` owns panel process orchestration, event subscription, and serialization. Scan, manifest, file load, search, translation candidate generation, editor save operations, and CLI shortcut runs coordinate through the project-level session.
- `src/core/panel-event-hub.ts` owns local filesystem watching for panel synchronization. It classifies config/cache/snapshot/locales changes and feeds SSE events without authorizing writes.
- `src/core/editor-service.ts` owns logical JSON file discovery, editor manifest/file construction, workspace search, selected-cell translation candidate generation, JSON Pointer writes, accepted-translation cache validation, revision checks, snapshot review updates, and atomic filesystem commits.
- `src/panel/contracts.ts` maps core results into panel API DTOs. Put package-version, local-only, and capability fields here instead of sprinkling them through the server.
- `src/panel/server.ts` owns HTTP routing, SSE response plumbing, translation job ids/poll/cancel lifecycle, loopback serving, Host/Origin checks, write-token checks, JSON body limits, security headers, static client fallback, and error serialization. It should delegate project behavior to `ProjectSession` and contract conversion helpers.

## Configuration and routes

- Public user configuration has two modes:
  - Single-master compatibility: top-level `baseLang + targetLangs`.
  - Multi-master mode: `routes: [{ sourceLang, targetLangs }]`.
- Do not mix top-level `baseLang + targetLangs` with `routes` in loaded user config.
- Legacy route entries with `baseLang` are accepted only for old projects and immediately normalize to `sourceLang`.
- After `loadConfigWithMetadata`, every backend caller should treat `config.routes` as canonical. The compatibility fields `config.baseLang` and `config.targetLangs` may remain for programmatic callers and old code, but new logic should not branch on them.
- Filtering languages from CLI arguments must preserve route ownership: selecting `fr ja` from `zh-Hans → ja, ko` and `en → de, fr` produces two routes, not one merged route.

## Cache and snapshot semantics

- Translation cache keys include `sourceLang + sourceText + targetLang`; same text translated from different masters must not collide.
- Cache format version is v2. Snapshot format version is v3. Version mismatch resets the cache data structure but must not rewrite existing target files.
- Normal incremental CLI runs must not prune otherwise valid old cache entries merely because their source text is no longer present. Cache mutation should come from explicit writes of successful translations, accepted AI drafts, cache version reset, or explicit force/refresh scope clearing.
- Snapshots record source text hashes by file, target language, key, and source language owner. They detect when a target needs retranslation after its master text changes.
- Diff, translation task, failure, and snapshot entry keys should use RFC 6901 JSON Pointer internally. When reading existing v3 snapshots, preserve backwards compatibility with older dotted entry keys so reviewed translations do not become pending after an upgrade.
- Old projects and incomplete snapshots are bootstrapped conservatively: existing target translations are treated as reviewed assets until a source change happens after the baseline.
- Changing master-route ownership does not directly rewrite target files. It changes future incremental baseline behavior.
- Full refresh/retranslation is explicit CLI behavior, or explicit editor `forceRetranslate` behavior for selected cells. Config edits, model edits, prompt edits, panel scan, and panel overview reads must not trigger retranslation.
- Master-to-master translation is a special one-time flow, not route ownership. It is allowed only in multi-master mode, requires both endpoints to be configured `sourceLang` values, and must not create a normal target route or update route snapshots for the target master.
- Panel CLI shortcut runs are direct-write equivalents of CLI commands, not browser drafts. They may update local JSON files, translation cache, and snapshots immediately after confirmation, and they must run through `ProjectSession` serialization.
- Plain manual editor saves do not write or delete translation cache entries.
- Selected-cell AI translation jobs, including master-to-master jobs, may read from cache while producing draft candidates. A later save may write cache entries only for accepted AI drafts that still match their saved source text and saved target text. If the user edits the AI draft or the source text changes before save, treat it as human-edited copy and do not write cache.

## Editor save semantics

- Editing a source/master language file:
  - Writes only the explicitly changed source cells.
  - Does not update target language snapshot entries.
  - Makes untouched target cells pending when their saved source hash differs from the reviewed snapshot.
- Editing a target language file:
  - Writes only the explicitly changed target cells.
  - Updates that target/key snapshot to the saved source text, marking the human-edited translation as reviewed.
- Editing a source and one target in the same save:
  - The edited target is reviewed against the new saved source.
  - Other targets remain pending when affected.
- When the first editor save sees an old, missing, or incomplete snapshot, bootstrap a complete v3 baseline from the pre-save project contents, then apply the current changes. This preserves old translations as reviewed while allowing this save to produce accurate pending state.
- `acceptedTranslations` on save is optional provenance, not a write command. Validate every item against configured route ownership, source language, target language, current saved source value, current saved target value, and the effective change set before writing it to cache.
- Accepted AI translations must be cached only after the file save succeeds. A save conflict or partial failure must not leave cache entries for unsaved target text.

## Editor AI translation jobs

- Editor translation APIs generate candidate translations for the current browser draft. They do not directly write local JSON files, snapshots, or cache entries.
- `panel --edit` is required to create or cancel translation jobs. Read-only panels may view editor data but must not run AI translation.
- Translation requests include the logical file, revisions, snapshot revision, selected cells, optional current drafts, and options such as overwriting existing drafts or forcing retranslation.
- Resolve each target cell through its route owner and `sourceLang`. Source values should come from the current draft when the source cell is edited in the same browser draft; otherwise use disk values.
- By default, selected-cell translation must follow CLI incremental semantics: generate candidates only for missing target cells, pending target cells, or cells affected by a source-language draft in the current browser draft. Existing reviewed target cells are skipped unless `forceRetranslate` is enabled.
- Skip master cells, unsupported cells, missing/non-string/empty source cells, unconfigured languages, changed drafts without overwrite permission, reviewed cells without `forceRetranslate`, and skipped keys. AI translation must always respect `skipKeys`; only direct manual table editing may override a skipped target value. `skipKeys` may match JSON Pointer patterns or legacy dotted glob patterns for compatibility.
- Return per-cell results with `translated`, `skipped`, or `failed` status. Cache hits are candidate results and still become drafts client-side before any save. When `forceRetranslate` is enabled, bypass cache reads and request fresh LLM output for the eligible cells.
- Cancelling a job stops pending/running work where possible. Completed results may remain in the browser draft; cancellation must not write files.
- Master-to-master editor jobs are separate from normal selected-cell route translation. They resolve source text from another master language, target only the selected/current master language, skip `skipKeys`, skip existing master copy unless `overwriteExisting` is explicit, and still return draft candidates only.

## JSON editor model

- The editor is a leaf-string table. Rows are the union of string leaf paths across configured languages for one logical JSON file.
- Row identity is RFC 6901 JSON Pointer, for example `/promotions/firstNightKit/product/title`.
- UI display may use breadcrumbs, but backend writes must decode JSON Pointers directly.
- Do not write through dotted flatten/unflatten identifiers. Real JSON keys may contain `.`, `/`, or `~`.
- Numbers, booleans, `null`, arrays, and objects are not editable cells. They must be preserved exactly unless a future explicit feature expands the model.
- Writing through a path where an intermediate segment is not an object must fail with a clear editor error.
- If at least one configured language has a logical JSON file, the editor may create missing physical JSON files for other configured languages during a save.
- Preserve parseable file traits where practical: BOM, indentation, newline style, trailing newline, and file mode. New target files default to two-space indentation.

## Panel API and local write boundary

- Read endpoints:
  - `GET /api/health`
  - `GET /api/project`
  - `POST /api/scan`
  - `GET /api/editor/events`
  - `GET /api/editor/manifest`
  - `GET /api/editor/file?path=...`
  - `GET /api/editor/search`
  - `GET /api/editor/translate-jobs/:id`
  - `GET /api/editor/master-translate-jobs/:id`
  - `GET /api/translation-runs/:id`
  - `GET /api/settings/config`
- Candidate-generation and write endpoints:
  - `POST /api/editor/translate-jobs`
  - `DELETE /api/editor/translate-jobs/:id`
  - `POST /api/editor/master-translate-jobs`
  - `DELETE /api/editor/master-translate-jobs/:id`
  - `PUT /api/editor/file`
  - `POST /api/translation-runs`
  - `PUT /api/settings/config`
- Default panel startup is read-only. `i18n-ai-diff panel --edit` enables content editing for that process only.
- Write requests and AI translation job creation must satisfy every boundary:
  - Server bound to loopback.
  - Host and Origin checks pass.
  - Current session write token is present.
  - `Content-Type: application/json`.
  - Request body is no larger than 5 MB.
  - Language is configured.
  - Path is a manifest-known relative `.json` logical file.
  - Absolute paths, `..`, encoded traversal, NUL bytes, unconfigured languages, and symlink traversal are rejected.
  - Revisions for all language files and the snapshot match current disk state.
- AI translation job cancellation (`DELETE /api/editor/translate-jobs/:id` and `DELETE /api/editor/master-translate-jobs/:id`) still requires edit mode, loopback Host/Origin checks, and the current session write token, but it is a bodyless request and does not require `Content-Type: application/json` or a JSON body.
- CLI shortcut runs require the same edit mode, loopback Host/Origin checks, current session write token, JSON content type, and body-size limit. Normal and force shortcut modes only accept configured target languages in the panel; master-to-master shortcut mode only accepts configured source master languages.
- Visual settings saves require the same edit mode, loopback Host/Origin checks, current session write token, JSON content type, body-size limit, and config-file revision check. Saving config may only patch managed fields inside a direct exported object/`defineConfig({ ... })` object. It must preserve custom imports, helper functions, comments outside changed managed properties, and un-managed expressions. It must not write locale JSON, cache, or snapshots, and the panel should require restart before new routes, paths, prompt, or watcher settings are treated as active. Settings may manage CLI watch debounce and ignored patterns, but must not expose or serialize `watch.enabled`; entering watch mode remains an explicit CLI `--watch` behavior.
- Visual settings must not serialize secrets or rewrite the `llm` block. The settings page may display the currently resolved model runtime values, but provider-specific runtime expressions remain user-owned source code.
- A revision mismatch returns `409 REVISION_CONFLICT` and must not partially overwrite files.
- Save should preflight the whole batch before committing. Commit physical files with same-directory temp files and atomic replacement. If a normal commit failure happens after a replacement, restore already replaced files from in-memory originals.

## Panel synchronization

- `GET /api/editor/events` is an SSE stream for local file changes. Events are hints to refresh manifests/files; they never authorize overwrites.
- Browser tabs may use BroadcastChannel for same-browser synchronization, but backend revision checks remain mandatory for every save.
- Coalesce or debounce bulk filesystem changes from CLI translation, cache updates, or snapshot updates so the panel does not thrash while many files are touched.
- If a watched file changes while a browser has drafts, preserve the draft and surface that save will still use revision checks. Do not silently replace unsaved browser edits.

## Testing expectations

- Config and route behavior: `tests/core/config-loader.routes.test.ts`, `tests/core/route-selector.test.ts`.
- Diff/snapshot/cache behavior: `tests/core/diff-analyzer.routes.test.ts`, `tests/utils/cache-manager.routes.test.ts`, translator integration tests.
- Editor write and JSON model behavior: `tests/core/editor-service.test.ts`, `tests/panel/editor-model.test.ts`.
- Editor search, selected-cell AI translation, and accepted cache behavior: `tests/core/editor-service.test.ts`, panel API tests, and targeted regressions near the changed service.
- Panel API security and contracts: `tests/panel/server.test.ts`.
- SSE and file synchronization behavior: `tests/core/project-session.test.ts`, `tests/panel/server.test.ts`, or focused event-hub tests.
- Broad backend regression: `npm test -- --run`.
- Panel-facing contract or tooling changes: also run `npm run build:panel`.
- Real consumer workspace changes: run `npm run test:consumer`.
- Release or package-consumption changes: run `npm run test:package`, `npm run test:install`, or `npm run test:consumer` as appropriate.
