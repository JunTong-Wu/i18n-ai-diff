# Backend constraints

## Layer ownership

- `src/types/index.ts` owns public and internal TypeScript contracts for config, translation tasks, project scan data, editor rows, and save requests. Avoid duplicating shape definitions in server or UI code.
- `src/core/config-loader.ts` owns config discovery, default merging, path resolution, validation, and route normalization.
- `src/core/route-selector.ts`, `src/core/diff-analyzer.ts`, `src/core/translator.ts`, `src/core/file-watcher.ts`, and `src/core/project-inspector.ts` own translation semantics. Keep them free of HTTP and browser concerns.
- `src/core/project-session.ts` owns panel process orchestration and serialization. Scan, manifest, file load, and save operations share the project-level queue.
- `src/core/editor-service.ts` owns logical JSON file discovery, editor manifest/file construction, JSON Pointer writes, revision checks, snapshot review updates, and atomic filesystem commits.
- `src/panel/contracts.ts` maps core results into panel API DTOs. Put package-version, local-only, and capability fields here instead of sprinkling them through the server.
- `src/panel/server.ts` owns HTTP routing, loopback serving, Host/Origin checks, write-token checks, JSON body limits, security headers, static client fallback, and error serialization. It should delegate project behavior to `ProjectSession` and contract conversion helpers.

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
- Snapshots record source text hashes by file, target language, key, and source language owner. They detect when a target needs retranslation after its master text changes.
- Old projects and incomplete snapshots are bootstrapped conservatively: existing target translations are treated as reviewed assets until a source change happens after the baseline.
- Changing master-route ownership does not directly rewrite target files. It changes future incremental baseline behavior.
- Full refresh/retranslation is explicit CLI behavior. Config edits, model edits, prompt edits, panel scan, and panel overview reads must not trigger retranslation.
- Manual editor saves do not write or delete translation cache entries.

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
  - `GET /api/editor/manifest`
  - `GET /api/editor/file?path=...`
- Write endpoint:
  - `PUT /api/editor/file`
- Default panel startup is read-only. `i18n-ai-diff panel --edit` enables content editing for that process only.
- Write requests must satisfy every boundary:
  - Server bound to loopback.
  - Host and Origin checks pass.
  - Current session write token is present.
  - `Content-Type: application/json`.
  - Request body is no larger than 5 MB.
  - Language is configured.
  - Path is a manifest-known relative `.json` logical file.
  - Absolute paths, `..`, encoded traversal, NUL bytes, unconfigured languages, and symlink traversal are rejected.
  - Revisions for all language files and the snapshot match current disk state.
- A revision mismatch returns `409 REVISION_CONFLICT` and must not partially overwrite files.
- Save should preflight the whole batch before committing. Commit physical files with same-directory temp files and atomic replacement. If a normal commit failure happens after a replacement, restore already replaced files from in-memory originals.

## Testing expectations

- Config and route behavior: `tests/core/config-loader.routes.test.ts`, `tests/core/route-selector.test.ts`.
- Diff/snapshot/cache behavior: `tests/core/diff-analyzer.routes.test.ts`, `tests/utils/cache-manager.routes.test.ts`, translator integration tests.
- Editor write and JSON model behavior: `tests/core/editor-service.test.ts`, `tests/panel/editor-model.test.ts`.
- Panel API security and contracts: `tests/panel/server.test.ts`.
- Broad backend regression: `npm test -- --run`.
- Panel-facing contract or tooling changes: also run `npm run build:panel`.
- Release or package-consumption changes: run `npm run test:package`, `npm run test:install`, or `npm run test:consumer` as appropriate.
