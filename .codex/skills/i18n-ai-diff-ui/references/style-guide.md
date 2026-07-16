# Panel UI style guide

## Design thesis

Create a bright, high-contrast ambient workspace that makes multi-master translation routing immediately understandable. Large white surfaces and generous spacing carry the hierarchy. Color appears only in the primary action, state feedback, icons, target dots, and the shared route wave.

## Visual source

Use `../assets/panel-visual-target.png` as the approved surface and component reference and `../assets/route-wave-reference.png` as the precise route-connector reference. The current shell deliberately replaces the reference sidebar with a compact fixed topbar so editing views can use the full viewport width. Adapt the layout to real and variable data rather than reproducing accidental fixed counts from the mock.

## Tokens

### Color

- Canvas: `#F6F8FC`.
- Surface: `#FFFFFF`.
- Quiet surface: `#F8FAFD` only when white-on-white needs separation.
- Primary ink: `#101828`.
- Secondary ink: `#5D6979`.
- Hairline: `#E4E9F1`; use sparingly.
- Brand/action blue: `#0F62E9`; hover `#0B4FC3`.
- Success: `#168A59`.
- Warning: `#D97706`.
- Danger: `#D92D20`.
- Decorative cobalt: `#1467F3`.
- Decorative violet: `#7C3AED`.
- Decorative teal: `#0FAFA8`.
- Decorative coral: `#F04438`.
- Decorative amber: `#F59E0B`.

Do not fill large route or record surfaces with decorative colors. Do not color metric numbers. Use the same decorative icon semantics in every route: source files cobalt, keys violet, tasks coral.

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
- Prefer no shadow. If separation needs depth, use one subtle shadow below the whole workspace or a major floating surface.
- Borders are hairlines, never the primary hierarchy mechanism.

## Desktop layout

- Keep the app full-height with a compact fixed topbar and a full-width main workspace.
- Keep product identity at the left, the small top-level navigation set beside it, and local-session context at the right. The selected navigation item uses a pale blue tint and brand-blue icon/text.
- Do not reserve permanent horizontal space for a sidebar; operational tables and editors take priority.
- Place the title and read-only explanation at the top left. Keep `Scan project` at the top right.
- Put the healthy state before the metrics so the scan result is understood before details.
- Use one wide metric band rather than separate floating metric cards.
- Stack route groups. Use one neutral route surface per master route.
- Keep secondary project record details in one broad neutral surface after route content.
- When pending files exist, place the change plan after the routes and before the project record. Do not hide it to preserve the mock's zero state.

## Routes and dynamic languages

- Use the same surface, type, connector, icons, and spacing for every master route.
- Do not assign route-specific colors.
- Lay a route out as source, shared wave, and targets on wide screens. Reflow them vertically on narrow screens.
- Render targets with `display: flex; flex-wrap: wrap` or an equivalent auto-flow layout.
- Keep target pills content-sized with a practical minimum width. Do not calculate columns from target count.
- Allow long locale codes to remain readable without truncating the language identity.
- Give each target pill a small decorative dot. Cycle the approved decorative palette by target index; the color has no business meaning.
- Reuse `panel/src/assets/route-wave.svg` for all routes. Its solid blue origin dot, thin low-amplitude cobalt-to-violet curve, and rounded arrow are a product signature, not a data encoding; do not add a halo, increase the amplitude, or approximate it with library icons.
- Show route metrics with consistent icon colors across routes: source files cobalt, keys violet, tasks coral.
- Use warning styling only when the target or route has pending work.

## States and interaction

- Scan button: brand blue, clear hover, pressed, disabled/loading, and visible keyboard focus.
- Copy editor: keep `Save changes` as its only primary action. Draft, pending, missing, skipped, conflict, and read-only states use small semantic markers on neutral table surfaces.
- Keep the Key path column frozen and route groups neutral. Master languages may use a quiet header tint, but language count and route count must stay data-driven.
- File writes are never automatic: editing is gated by `panel --edit`, changes remain a per-file browser draft, and conflicts must be resolved before saving.
- Success: green icon and text; keep the surrounding surface neutral or barely tinted.
- Pending: amber label/icon; never recolor the whole route.
- Error: red message with a retry action; keep it concise and actionable.
- Loading: neutral skeletons with reduced-motion fallback.
- Hover: small elevation or border/ink change only. Do not make cards jump noticeably.
- Focus: visible 3 px blue outline with sufficient offset.

## Responsive behavior

- At tablet widths, let the topbar wrap into a compact identity/session row plus navigation row without losing the local-session indicator.
- At 390 px, stack the header action, metrics, route source, connector, targets, route metrics, and project record.
- Keep primary tap targets at least 44 px.
- Prevent horizontal page scrolling. Permit horizontal scrolling only inside a pending-change table if no clearer mobile representation is practical.
- Preserve route and state hierarchy when text wraps or locale codes are long.

## Accessibility and content

- Keep one `h1`, logical headings, semantic buttons, lists for targets, and definition lists for project metadata.
- Announce scan loading and completion through the existing live region.
- Provide accessible names for icon-only controls and hide decorative icons from assistive technology.
- Maintain AA contrast for body and UI text.
- Respect `prefers-reduced-motion`.
- Preserve the product terms `Multi-master`, `Single-master`, `Master routes`, `File tasks`, `Cache`, and `Snapshot`.
- Show the local project root once, as its directory name in the `Local session` card. Show Config and Locales as `./`-prefixed paths when they are inside that root, retain external paths as absolute, and expose the full value in the native title tooltip. Never repeat long absolute prefixes that truncate into indistinguishable labels.
