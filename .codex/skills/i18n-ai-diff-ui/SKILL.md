---
name: i18n-ai-diff-ui
description: Apply and protect the i18n-ai-diff local Web panel's approved UI system. Use when creating, modifying, reviewing, or testing files under panel/, including the overview bento workspace, VTable table editor, CLI shortcut page, Settings page, Explorer/Details drawers, global search, selected-cell AI translation UI, shared shadcn/Radix primitives, panel-facing assets, responsive layouts, component states, visual tokens, or design QA.
---

# i18n-ai-diff UI

Build the panel as a high-contrast ambient SaaS workspace: neutral large surfaces, generous space, large radii, crisp typography, and small purposeful color accents.

## Required context

Read [references/style-guide.md](references/style-guide.md) completely before changing panel UI. Treat the style guide as the current source of truth for visual design, shared UI primitives, table-editor table behavior, SCSS ownership, responsive placement, Tailwind V3 usage, and priority rules. The images under `assets/` are historical visual references for spacing, atmosphere, and the route-wave signature only; they must not reintroduce legacy sidebar layouts, blue primary actions, hoverable display cards, or surface borders.

## Workflow

1. Preserve translation, routing, cache, snapshot, and scan semantics. Limit visual work to the panel unless the requested UI behavior requires a typed API change.
2. Reuse shared UI primitives before adding page-local shells: `components/ui/modal.tsx`, `dialog.tsx`, `sheet.tsx`, `popover.tsx`, `checkbox.tsx`, `select.tsx`, `input.tsx`, `textarea.tsx`, and `sonner.tsx`.
3. Reuse the SCSS modules under `panel/src/styles/`, especially `panel/src/styles/_tokens.scss`; promote repeated values to variables instead of adding one-off colors or sizes.
4. Keep responsive rules beside the selector they modify. Do not create catch-all `responsive/` partials or page-bottom breakpoint dumps for component-specific styles.
5. Keep Tailwind V3 as a low-level utility layer: import `tailwind.css` before `index.scss`, keep preflight disabled, and put reusable `@apply` primitives in `_tailwind-apply.scss`.
6. Keep route surfaces visually identical. Never use color to distinguish one master route from another.
7. Render target languages from data in a wrapping collection. Support one, many, and long locale codes without fixed counts or fixed rows.
8. Reserve semantic colors for state. Use decorative colors only on small icons, target dots, route-wave accents, table cell states, and file/status badges.
9. Use the existing icon library for UI icons. The shared route connector is the sole custom SVG exception: preserve `panel/src/assets/route-wave.svg` as the approved product signature instead of substituting a generic wave or arrow icon. Do not add other handcrafted SVG or CSS illustrations.
10. Preserve loading, error, pending, success, disabled, focus, selected, editable, read-only, and reduced-motion states. Add hover treatment only to genuinely interactive controls; display-only cards and badges must not imply clickability.
11. Verify at 1440 × 1024 and at a narrow 390 px viewport. Check keyboard focus, text wrapping, overflow, drawer/modal behavior, the scan action, table-editor search/filter/translate controls, and save states.

## Non-negotiable rules

- Keep one primary action per view: `Scan project` on the overview and `Save changes` in the table editor.
- Use the compact fixed, edge-attached topbar shell for product identity, local-session context, and the small set of top-level destinations. Do not reintroduce a desktop sidebar, floating topbar card, or extra window margin.
- Use large neutral surfaces; do not introduce large colored panels, route-specific fills, glassmorphism, or decorative gradients.
- Separate content with space and surface contrast; do not add surface borders. Data-table grid lines are the only structural exception when required for editing legibility.
- Use black for primary actions and active top-level navigation. Use neutral gray fills for secondary active states. Do not bring back a blue brand button or pale-blue active menu treatment.
- Keep semantic SCSS as the source of product UI truth. Do not rewrite stable panel surfaces into JSX-only Tailwind utility piles, do not enable Tailwind preflight, and do not use Tailwind important modifiers for product UI.
- Keep overview PC layout on a 12-column bento grid with 8-column main cards and 4-column side-rail cards. Do not introduce full-width overview business cards on PC.
- Treat overview route cards, project records, metrics, badges, and status summaries as display surfaces unless the UI explicitly wires an action to them. Display surfaces have no hover visual change.
- Keep the main text nearly black and secondary text clearly legible; avoid gray-on-gray composition.
- Keep the colorful wave, icons, and language dots small. They decorate or communicate state; they do not encode route identity.
- Keep the route connector faithful to the approved SVG: one solid blue origin dot, a thin low-amplitude cobalt-to-violet curve, and a rounded violet arrow. Do not add a halo or substitute a large sine wave. Reuse one asset across every route.
- Keep the panel local-first and read-only during scanning. Do not imply that a scan writes translations. Copy editing must remain explicitly gated by `panel --edit` and an explicit save.
- Keep modals and drawers visually unified through shared primitives. Do not create one-off modal headers, close buttons, overlay shells, checkbox styles, or drawer headers for each feature.
- Do not remove project details or pending-change visibility when adapting the reference for real data.

## Completion gate

For visual changes, run the panel build and browser-based visual QA. Run repository tests when behavior, data flow, Tailwind/PostCSS configuration, or build tooling changes. Compare against the current style guide first; use historical images only to check the route-wave signature and broad visual atmosphere. Do not hand off while actionable layout, responsive, accessibility, content, or state defects remain.
