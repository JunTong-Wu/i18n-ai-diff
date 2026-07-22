---
name: i18n-ai-diff-cli
description: Protect i18n-ai-diff command-line behavior and npm package consumption. Use when modifying src/bin/cli.ts, CLI-facing config/docs, README command examples, package bin/scripts, panel CLI shortcut behavior, watch/force/language filtering, panel port/edit flags, translate-master, release/versioning, package smoke tests, or any behavior users invoke through npx/npm.
---

# i18n-ai-diff CLI

Keep the CLI boringly reliable: stable commands, predictable file writes, clear logs, conservative translation semantics, and package behavior that matches real `npx i18n-ai-diff` usage.

## Required context

Before changing CLI behavior, read [references/cli-contract.md](references/cli-contract.md) completely. It is the source of truth for public commands, option semantics, docs expectations, dev-only scripts, validation, and release checks.

If a CLI change touches translation internals, panel APIs, cache/snapshot behavior, or local file writes, also use `i18n-ai-diff-backend`. If it touches the visual CLI shortcut page or panel navigation, also use `i18n-ai-diff-ui`.

## Workflow

1. Classify the change before editing:
   - Public CLI: `src/bin/cli.ts`, option parsing, command names, exit codes, logs.
   - Package surface: `package.json` `bin`, `files`, version, npm scripts, package/install smoke tests.
   - User docs: `README.md`, `README_zh.md`, command examples, terminology.
   - Panel parity: CLI shortcut page command generation/execution and backend runner.
2. Preserve backwards-compatible command behavior unless the user explicitly asks to break it.
3. Keep single-master and multi-master CLI behavior aligned with the normalized `sourceLang → targetLangs` route model.
4. Keep CLI shortcut runs equivalent to CLI direct-write commands. Do not mix them with table-editor draft semantics.
5. Update tests and bilingual docs in the same change when public command behavior changes.

## Non-negotiable rules

- Keep the executable name `i18n-ai-diff` and package `bin` path valid after build.
- Do not rename or repurpose existing options silently. Add new options with clear help text and README examples.
- Treat `--force` as explicit retranslation/refresh behavior. It must bypass reviewed-copy preservation and clear/ignore cache only where the command contract says so.
- Treat normal CLI runs as incremental. Changing config, model, prompt, or route ownership must not rewrite reviewed translations by itself.
- Preserve multi-master route ownership when filtering languages with `-l/--langs`.
- Keep `translate-master` separate from normal route translation. It is allowed only between configured master/source languages in multi-master mode.
- Keep `panel --edit` as the explicit gate for local panel writes and panel-triggered CLI shortcut execution.
- Keep `panel --port 0` valid; it lets Node allocate an available loopback port and must print the actual URL.
- Keep watch mode explicit through `-w/--watch`. Config `watch` values tune debounce/ignore behavior; they do not enable watch mode by themselves.
- Keep CLI logs useful but not noisy. Errors should exit non-zero and explain the actionable failure.

## Completion gate

Run focused tests for the changed command path. For public CLI or package-surface changes, run `npm test -- --run` and at least one package-consumption check: `npm run test:package`, `npm run test:install`, or `npm run test:consumer` as appropriate. For release-level changes, run `npm run test:release`. If a validation step is intentionally skipped, state why.
