---
name: i18n-ai-diff-backend
description: Protect i18n-ai-diff backend, core, and local panel API architecture. Use when modifying src/core, src/panel, src/types, src/utils cache/snapshot logic, CLI panel behavior, configuration loading, translation routing, editor write APIs, or backend tests.
---

# i18n-ai-diff backend

Keep the package local-first, multi-master-safe, and conservative with user-owned translation files. Backend work must preserve the reviewed-translation contract: existing target copy is an asset unless the user explicitly translates, refreshes, or saves an edit.

## Required context

Before changing backend or API behavior, read [references/backend-constraints.md](references/backend-constraints.md) completely. It is the source of truth for layer ownership, multi-master route semantics, snapshot/cache behavior, editor write boundaries, and validation gates.

## Workflow

1. Classify the change surface before editing:
   - Public config/types: `src/types/index.ts`, `src/core/config-loader.ts`, README examples.
   - Translation semantics: route selection, diff analysis, translator, cache, snapshot, watcher, project session.
   - Panel API/editor: `src/panel/*`, `src/core/editor-service.ts`, panel contracts, server tests.
2. Keep single-master and multi-master implementations unified internally through `sourceLang` routes. Do not add a parallel single-master path.
3. Keep `src/panel/server.ts` thin: HTTP, security checks, JSON parsing, static serving, and contract mapping only. Put domain decisions in core services.
4. Keep write operations explicit and serialized through `ProjectSession`. Do not introduce background writes from scans or overview reads.
5. Add or update tests near the behavior being protected. Prefer focused regression tests for route ownership, old snapshot migration, revision conflicts, and path safety.

## Non-negotiable rules

- New public multi-master configuration uses `routes[].sourceLang`; legacy route `baseLang` is read-only compatibility and normalizes immediately.
- Translation tasks, file results, cache entries, snapshots, failures, and panel API DTOs use `sourceLang` internally.
- Changing config, model, prompt, or route ownership must not rewrite existing target-language files by itself.
- Manual editor saves never invoke the LLM and never mutate translation cache entries.
- Read-only panel mode must expose data but reject writes. Editable mode still requires loopback binding, Host/Origin checks, JSON content type, body-size limit, a write token, safe relative JSON paths, configured languages, and revision checks.
- JSON editor rows use JSON Pointer identities. Do not use dotted flatten/unflatten identifiers for writes because real keys may contain `.`, `/`, or `~`.
- Preserve non-string JSON nodes, formatting, newline style, and existing file mode where the editor touches files.

## Completion gate

Run `npm test -- --run` for backend behavior changes. Also run `npm run build:panel` when contracts or panel-facing API payloads change. For release-level changes, run the package and consumer smoke tests. If a validation step is intentionally skipped, state why.
