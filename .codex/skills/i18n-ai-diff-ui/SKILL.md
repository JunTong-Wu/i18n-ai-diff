---
name: i18n-ai-diff-ui
description: Apply and protect the i18n-ai-diff local Web panel's approved UI system. Use when creating, modifying, reviewing, or testing files under panel/, panel-facing UI assets, responsive layouts, component states, visual tokens, or design QA for the translation workspace.
---

# i18n-ai-diff UI

Build the panel as a high-contrast ambient SaaS workspace: neutral large surfaces, generous space, large radii, crisp typography, and small purposeful color accents.

## Required context

Read [references/style-guide.md](references/style-guide.md) completely before changing panel UI. Treat [assets/panel-visual-target.png](assets/panel-visual-target.png) as the visual source of truth.

## Workflow

1. Preserve translation, routing, cache, snapshot, and scan semantics. Limit visual work to the panel unless the requested UI behavior requires a typed API change.
2. Reuse the tokens and component patterns in `panel/src/styles.css`; promote repeated values to variables instead of adding one-off colors or sizes.
3. Keep route surfaces visually identical. Never use color to distinguish one master route from another.
4. Render target languages from data in a wrapping collection. Support one, many, and long locale codes without fixed counts or fixed rows.
5. Reserve semantic colors for state. Use decorative colors only on small icons, target dots, and the route wave.
6. Use the existing icon library for UI icons. The shared route connector is the sole custom SVG exception: preserve `panel/src/assets/route-wave.svg` as the approved product signature instead of substituting a generic wave or arrow icon. Do not add other handcrafted SVG or CSS illustrations.
7. Preserve loading, error, pending, success, disabled, hover, focus, and reduced-motion states.
8. Verify at 1440 × 1024 and at a narrow 390 px viewport. Check keyboard focus, text wrapping, overflow, the scan action, and copy-editor save states.

## Non-negotiable rules

- Keep one primary action per view: `Scan project` on the overview and `Save changes` in the copy editor.
- Use the compact fixed topbar shell for product identity, local-session context, and the small set of top-level destinations. Do not reintroduce a desktop sidebar.
- Use large neutral surfaces; do not introduce large colored panels, route-specific fills, glassmorphism, or decorative gradients.
- Separate content with space and surface contrast before adding rules or borders.
- Keep the main text nearly black and secondary text clearly legible; avoid gray-on-gray composition.
- Keep the colorful wave, icons, and language dots small. They decorate or communicate state; they do not encode route identity.
- Keep the route connector faithful to the approved SVG: one solid blue origin dot, a thin low-amplitude cobalt-to-violet curve, and a rounded violet arrow. Do not add a halo or substitute a large sine wave. Reuse one asset across every route.
- Keep the panel local-first and read-only during scanning. Do not imply that a scan writes translations. Copy editing must remain explicitly gated by `panel --edit` and an explicit save.
- Do not remove project details or pending-change visibility when adapting the reference for real data.

## Completion gate

Run the repository tests, panel build, and browser-based visual QA. Compare the implementation with the source image at the same desktop viewport. Do not hand off while actionable layout, responsive, accessibility, content, or state defects remain.
