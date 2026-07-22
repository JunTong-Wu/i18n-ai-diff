# Panel UI style guide

## Design thesis

Create a bright, high-contrast ambient workspace that makes multi-master translation routing immediately understandable. Large white and quiet-gray surfaces with generous spacing carry the hierarchy. Color appears only in state feedback, small decorative icons, target dots, and the shared route wave. Primary actions and global selected navigation use a black-and-white treatment; secondary controls use neutral selected fills.

## Visual source

Use `../assets/route-wave-reference.png` as the precise route-connector reference. Use `../assets/panel-visual-target.png` only as a historical atmosphere reference for generous spacing, rounded surfaces, and small color accents. The current style guide supersedes older mock details: no desktop sidebar, no floating topbar card, no blue primary button, no surface borders, and no hover treatment on display-only cards.

## Tokens

### Color

- Canvas: `#F6F8FC`.
- Surface: `#FFFFFF`.
- Quiet surface: `#F8FAFD` only when white-on-white needs separation.
- Primary ink: `#101828`.
- Secondary ink: `#5D6979`.
- Brand/action black: `#101828`; hover `#000000`.
- Neutral selected/control hover fill: `#EEF1F5`.
- Disabled action fill: `#F1F4F8`; disabled action text: `#7A8493`.
- Success: `#168A59`.
- Warning: `#D97706`.
- Danger: `#D92D20`.
- Decorative cobalt: `#1467F3`.
- Decorative violet: `#7C3AED`.
- Decorative teal: `#0FAFA8`.
- Decorative coral: `#F04438`.
- Decorative amber: `#F59E0B`.

Do not use blue as the product brand/action color. Do not fill large route or record surfaces with decorative colors. Do not color metric numbers. Use the same decorative icon semantics in every route: source files cobalt, keys violet, tasks coral.

### Typography

- Use `Inter`, then system UI fallbacks. Do not add a display serif.
- Page title: 32–38 px, weight 700, line-height about 1.15.
- Section title: 18–20 px, weight 700.
- Route source language: 28–32 px, weight 700.
- Metric value: 24–30 px, weight 650–700.
- Body: 15–16 px, line-height 1.5.
- Supporting labels: 12–14 px, weight 500–600.
- Use sentence case. Reserve uppercase for tiny structural labels such as `Master` and `Target languages`.

### Shape, depth, and spacing

- App and major panel radius: 28–32 px.
- Section and route radius: 20–24 px.
- Button radius: 14–18 px.
- Pill radius: 12–999 px depending on height.
- Use 4/8-based spacing. Desktop section gaps should usually be 28–40 px.
- Prefer no shadow. If separation needs depth, use one subtle shadow below a major floating surface such as a modal or drawer only.
- Do not use borders as surface separators. Cards, buttons, alerts, badges, drawers, topbars, and panels should be distinguished by solid fills, spacing, typography, and state color blocks. Data-table grid or active-edit affordances are the only acceptable structural exception when required for legibility.

## Desktop layout

- Keep the app full-height with a compact fixed, edge-attached topbar and a full-width main workspace.
- Keep product identity at the left, the small top-level navigation set beside it, and local-session context at the right. The top-level destinations are Project overview, Copy editor, CLI shortcut, and Settings. The selected top-level navigation item uses black fill with white icon/text. Nested editor controls and selected file rows use neutral selected fill with dark text.
- Do not reserve permanent horizontal space for a sidebar; operational tables and editors take priority. Do not style the topbar as a floating rounded card.
- Use the shared layout slots consistently across views: fixed global topbar, optional operation bar below it, content workspace, and optional fixed bottom status bar. Keep the editor table from being covered by bottom status content.
- On feature bento pages such as CLI shortcut and Settings, card headers must use only the card icon plus one large title. Do not add eyebrow labels, small subtitles, or explanatory paragraphs inside the card header; move essential safety or state copy into the card body.
- On the overview, use a 12-column bento grid on PC widths. Primary workspace cards use 8 columns and right-rail cards use 4 columns. Do not use full-width business cards on PC; pending, operational, project record, metrics, and scan-history surfaces must align to either the 8-column main rail or the 4-column side rail.
- Place the title and read-only explanation at the top left. Keep `Scan project` at the top right.
- Put the healthy state before the metrics so the scan result is understood before details.
- Put project metrics in the 4-column right rail beside the hero. Keep metrics as one grouped card, not separate floating metric cards.
- Stack route groups in the 8-column main rail. Use one neutral route surface per master route.
- Keep project record and operational state in the 4-column right rail so the side edge stays aligned.
- When pending files exist, place the change plan after the routes in the 8-column main rail. Do not hide it to preserve the mock's zero state, and do not render it as a full-width table.

## Routes and dynamic languages

- Use the same surface, type, connector, icons, and spacing for every master route.
- Do not assign route-specific colors.
- Lay a route out as source, shared wave, and targets on wide screens. Reflow them vertically on narrow screens.
- In constrained bento widths, protect the route wave from overlap by wrapping target content below the source/wave row before the language list collides with the SVG.
- Render targets with `display: flex; flex-wrap: wrap` or an equivalent auto-flow layout.
- Keep target pills content-sized with a practical minimum width. Do not calculate columns from target count.
- Allow long locale codes to remain readable without truncating the language identity.
- Give each target pill a small decorative dot. Cycle the approved decorative palette by target index; the color has no business meaning.
- Reuse `panel/src/assets/route-wave.svg` for all routes. Its solid blue origin dot, thin low-amplitude cobalt-to-violet curve, and rounded arrow are a product signature, not a data encoding; do not add a halo, increase the amplitude, or approximate it with library icons.
- Show route metrics with consistent icon colors across routes: source files cobalt, keys violet, tasks coral.
- Use warning styling only when the target or route has pending work.

## States and interaction

- Scan button: black fill when enabled; disabled/loading actions use the neutral disabled fill. Keep clear hover, pressed, no drop shadow, and visible keyboard focus.
- Copy editor: keep `Save changes` as its only primary action. Draft, pending, missing, skipped, conflict, AI draft, failed translation, and read-only states use small semantic markers on neutral table surfaces.
- Keep the Key path column frozen and route groups neutral. Master languages may use a quiet header tint, but language count and route count must stay data-driven.
- File writes are never automatic: editing is gated by `panel --edit`, changes remain a per-file browser draft, and conflicts must be resolved before saving.
- Success: green icon and text; keep the surrounding surface neutral or barely tinted.
- Pending: amber label/icon; never recolor the whole route.
- Error: red message with a retry action; keep it concise and actionable.
- Loading: neutral skeletons with reduced-motion fallback.
- Hover: use fill or ink changes only on actual controls such as buttons, links, tabs, search controls, and editable file rows. Display-only route cards, record cards, metrics, badges, target pills, status summaries, and notification surfaces do not change on hover.
- Focus: visible 3 px black outline with sufficient offset for general controls. Large text inputs and textareas use the shared `Input`/`Textarea` soft-focus treatment instead: no heavy black outline, white active field, and a quiet neutral focus halo.

## Copy editor table

- Use VisActor VTable `ListTable` for the copy editor. Do not switch to a free spreadsheet/sheet interaction model unless the product direction explicitly changes.
- Keep the table as the dominant editor surface. Put high-frequency controls in the operation bar or context menu, and low-frequency details in drawers.
- Keep `Key path` frozen and language columns horizontally scrollable inside the table. Avoid page-level horizontal scrolling.
- Preview and edit mode typography must match. Body cells use compact copy sizing, consistent line-height, consistent padding, and top vertical alignment. Do not let preview text vertically center while textarea editing aligns to the top.
- Use auto-height for long copy rows without increasing every row. Maintain a minimum editing overlay height so one-line textarea editing has enough click/typing space.
- Preserve multiline copy, template variables, and HTML fragments visually. Do not clamp edit mode; preview clamping is acceptable only when the table remains navigable and full content remains editable.
- Surface table states with small fills/markers: Changed, Pending, Missing, Skipped, AI draft, Failed. Skipped cells must have a visible skipped background. Pending and AI states must remain distinguishable from ordinary Changed.
- Keep the bottom status bar lightweight: show current logical file path on the left and cell-state counts on the right. Do not add a floating bottom panel that covers the final table row.

## Editor controls, drawers, and modals

- Use shadcn/Radix primitives already wrapped in `panel/src/components/ui/` for interactive overlays and form controls: `Popover`, `Sheet`, `Dialog`, `Checkbox`, `Select`, `Input`, `Textarea`, `Sonner`, and the shared business `Modal` components.
- All business modals must use `components/ui/modal.tsx` for the content shell, header, title/description block, close button, and actions. Feature-specific classes may define internal content layout only. Do not create one-off modal shells such as custom close buttons, header spacing, or independent overlay card styling.
- Modal size may vary by intent: confirmation modals stay compact, workspace search can use the large size. The visual language—radius, padding, close button, title weight, action row, surface colors, and overlay treatment—must remain shared.
- Explorer and Details must both use full-height `Sheet` drawers with matching header structure and visible close buttons. Explorer opens from the left; Details opens from the right.
- The Explorer drawer is a VSCode-like file navigator. Show file and directory status with compact right-side badges, not large colored rows. Badge fills use light state tints and same-hue darker text. Selected rows stay neutral; selected state must not force badge text to black.
- Explorer status priority is `Invalid JSON` > `Missing language files` > `Pending keys` > clean. Directory headings summarize descendant status; file rows show concrete status/count.
- Search, filters, selected-cell translation, batch translation, Undo/Redo, Explorer, Details, and Save remain visible or one click away in the operation bar. Do not hide frequent actions inside drawers.
- Global workspace search is a modal. It searches copy across configured locale files, can optionally include key paths, and uses shadcn `Checkbox` controls for language/state filters.
- Selected-cell AI translation is a confirmation modal. Translation results enter the current browser draft first; Save writes local files later. The modal must not imply direct filesystem writes. Default selected-cell translation follows CLI incremental semantics; expose `Force retranslate · ignore cache` as an explicit opt-in inside this modal when reviewed cells need fresh LLM output. Do not expose an AI override for `skipKeys`; skipped cells remain excluded from AI translation and may only be overridden through direct manual table editing.
- Master-to-master AI translation is available only from a master language column-header context menu. Use the same shared confirmation modal shell as selected-cell translation, show the source-master selector and overwrite/cache options inside the modal, and keep results as browser drafts until Save.
- CLI shortcut is a separate top-level page for cross-file CLI-equivalent runs. It must use the shared topbar, operation bar, bottom bar, bento card surfaces, shadcn `Dialog`/business modal shell, and black primary action. It may generate copyable commands in read-only mode, but direct execution is gated by `panel --edit` and must clearly state that it writes local files, cache, and snapshots immediately rather than creating editor drafts.
- Settings is a separate top-level page for visual `i18n-translate.config.*` editing. It must use the shared topbar, operation bar, bottom bar, bento card surfaces, shared modal shell, shadcn-style `Input`/`Textarea` form primitives, and black primary `Save settings` action. Treat config saves as explicit local writes gated by `panel --edit`, write token, same-origin checks, and revision checks. The page must not imply that changing config rewrites locale JSON, cache, or snapshots; after saving, clearly require restarting the panel for routes, paths, model, prompt, or watcher changes to apply.

## Responsive behavior

- At tablet widths, let the topbar wrap into a compact identity/session row plus navigation row without losing the local-session indicator.
- At 390 px, stack the header action, metrics, route source, connector, targets, route metrics, and project record.
- Keep primary tap targets at least 44 px.
- Prevent horizontal page scrolling. Permit horizontal scrolling only inside data tables or pending-change tables if no clearer mobile representation is practical.
- Preserve route and state hierarchy when text wraps or locale codes are long.

## SCSS authoring model

- Follow the local style pattern used by the companion `headless-global-site`: keep global entry files as declarative `@use` manifests, and keep component/page rules in their owning partials.
- Write responsive overrides directly below the selector they modify, using nested `@media` or `@container` blocks. Avoid detached `responsive/` partials and page-bottom breakpoint dumps for component-specific styling.
- Put local breakpoint constants or maps at the top of the owning SCSS file only when that file actually needs them. Prefer existing CSS variables from `_tokens.scss` for shared colors, radii, spacing, and motion.
- Keep selector ownership obvious: shell layout in `_shell.scss`, overview bento concerns in `overview/_bento.scss`, route display in `overview/_routes.scss`, editor table rules in `editor/_table.scss`, and fullscreen editor controls in `editor/fullscreen/*`.
- Global media queries are acceptable only for truly global concerns such as reduced motion, reset behavior, or browser capability fixes.

## Tailwind V3 authoring and priority rules

- Use Tailwind V3 as the low-level utility layer, following `headless-global-site`: import `panel/src/styles/tailwind.css` before `panel/src/styles/index.scss`, then let semantic SCSS partials define the product UI.
- Keep Tailwind preflight disabled. The panel reset belongs to `_base.scss`; this protects VTable internals and prevents Tailwind from silently changing the approved visual system.
- Prefer semantic class names in React for business UI. Use Tailwind utilities directly in JSX only for small one-off layout helpers that do not compete with an owning SCSS selector.
- Prefer `@apply` for reusable primitives that are shared across pages, such as screen-reader utilities or tiny motion helpers. Put those in `_tailwind-apply.scss`, not inside unrelated component partials.
- If a utility and a semantic selector would set the same property, the semantic SCSS wins by import order. Move intentional overrides into the owning SCSS partial instead of relying on JSX class order.
- Do not use Tailwind `!` important modifiers for product UI. Reserve `!important` only for unavoidable third-party generated DOM overrides, and keep those overrides in the owning vendor/table partial.
- Continue writing responsive rules next to their selectors in SCSS. Tailwind responsive utilities are acceptable for isolated JSX helpers, but page/component responsive behavior should remain in the owning SCSS file.

## Accessibility and content

- Keep one `h1`, logical headings, semantic buttons, lists for targets, and definition lists for project metadata.
- Announce scan loading and completion through the existing live region.
- Provide accessible names for icon-only controls and hide decorative icons from assistive technology.
- Maintain AA contrast for body and UI text.
- Respect `prefers-reduced-motion`.
- Preserve the product terms `Multi-master`, `Single-master`, `Master routes`, `File tasks`, `Cache`, and `Snapshot`.
- Show the local project root once, as its directory name in the `Local session` card. Show Config and Locales as `./`-prefixed paths when they are inside that root, retain external paths as absolute, and expose the full value in the native title tooltip. Never repeat long absolute prefixes that truncate into indistinguishable labels.
