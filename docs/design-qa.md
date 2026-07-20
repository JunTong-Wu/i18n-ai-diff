# Panel design QA

- Source visual truth: `/Users/mebius/personal/i18n-ai-diff/.codex/skills/i18n-ai-diff-ui/assets/panel-visual-target.png`
- Connector source detail: `/Users/mebius/personal/i18n-ai-diff/.codex/skills/i18n-ai-diff-ui/assets/route-wave-reference.png`
- Browser-rendered implementation: `/Users/mebius/personal/i18n-ai-diff/output/design-qa/panel-route-wave-final.png`
- Full-view comparison: `/Users/mebius/personal/i18n-ai-diff/output/design-qa/panel-full-comparison-final.png`
- Focused connector comparison: `/Users/mebius/personal/i18n-ai-diff/output/design-qa/route-wave-comparison-final.png`
- Mobile evidence: `/Users/mebius/personal/i18n-ai-diff/output/design-qa/panel-route-wave-mobile-final.png`
- Readable-path evidence: `/Users/mebius/personal/i18n-ai-diff/output/design-qa/panel-readable-paths-detail.png`
- Desktop viewport: 1440 × 1024
- Mobile viewport: 390 × 844
- State: multi-master consumer fixture, 9 languages, 2 routes, 259 file tasks, no pending changes

## Findings

No actionable P0, P1, or P2 differences remain for the corrected route connector.

## Full-view comparison evidence

The paired full-view comparison places the user's original desktop design on the left and the browser-rendered packaged implementation on the right. The final implementation preserves the existing accepted panel layout and now restores the connector's intended scale and visual weight: a 200 × 32 desktop asset between the master and target groups, reused without route-specific styling.

The implementation retains additional real project detail below the first viewport and slightly roomier route cards. Those are intentional phase-one product constraints and do not change the connector fidelity requested in this iteration.

## Focused comparison evidence

The normalized connector comparison confirms the source and implementation use the same composition: one solid blue origin dot, a thin rounded curve with one shallow downward trough, a horizontal recovery, a continuous cobalt-to-violet gradient, and a small rounded arrowhead. There is no halo, thick stroke, or high-amplitude sine wave.

## Required fidelity surfaces

- Fonts and typography: This iteration does not alter typography. The established Inter/system stack, weights, labels, wrapping, and hierarchy remain intact.
- Spacing and layout rhythm: The connector renders at 200 × 32 on the 1440 px desktop view, aligning between the master label and the target group as in the source. At 390 px it scales to 176 × 28 and the route cards remain within the viewport.
- Colors and visual tokens: The SVG uses the approved action blue/cobalt/violet tokens and a continuous left-to-right gradient. It introduces no route-specific meaning or large colored surface.
- Image quality and asset fidelity: The user explicitly requested an SVG recreation. The external SVG remains crisp, uses rounded caps and joins, and is shared by both routes. The precise user-supplied connector crop is now stored alongside the project UI skill as its source of truth.
- Copy and content: No copy, route data, project metrics, cache state, or scan semantics changed.
- Responsiveness and accessibility: At 390 px, document `scrollWidth` equals `innerWidth` (390 px); both route cards stay within 332 px and the decorative SVG remains hidden from assistive technology through its empty alternative text and parent `aria-hidden`.

## Interaction and runtime verification

- Verified the packaged consumer panel at `http://127.0.0.1:4187/`, running version 1.2.0 with the new JS and CSS asset hashes.
- Verified two complete 200 × 32 SVG instances on desktop and two 176 × 28 instances on mobile.
- Verified 9 languages, 2 routes, 259 file tasks, and zero pending files remain unchanged.
- The primary `Scan project` interaction was verified in the accepted panel baseline; this asset-only correction does not change its handler or API path.
- Checked browser console warnings and errors on the corrected build: none.

## Readable path follow-up

- The `Local session` card shows only `i18n-ai-diff-consumer`; its title retains the full project root.
- Config shows `./i18n-translate.config.mjs` and Locales shows `./locales`; each title retains its complete absolute path.
- At 390 px, the project name and both relative paths fit without internal truncation, and document `scrollWidth` remains equal to `innerWidth`.
- External paths that do not belong to the project root remain absolute so the panel never misrepresents their location.

## Comparison history

- Iteration 1 — blocked, P1: the first SVG used the wrong visual source and produced a thick, high-amplitude wave with a halo. This materially contradicted the original design.
- Fix: replaced the geometry with a 200 × 32 external SVG using a 7 px solid origin dot, 2.25 px rounded stroke, shallow cubic curve, and continuous blue-to-violet gradient; updated desktop track sizing and the project UI skill.
- Iteration 2 — passed: the focused side-by-side comparison shows the corrected source and browser implementation have matching shape, weight, direction, and color progression. No P0/P1/P2 issue remains.

## Follow-up polish

No connector-specific follow-up is required.

## Final result

passed
