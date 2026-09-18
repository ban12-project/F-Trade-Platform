# Workspace HIG / Modern Web audit

Issue: #387

Source baseline: `56b51b9e62e4f96d9899f7e1132c3145e07ca098`

Audit date: 2026-09-18

## Scope and references

This change addresses shared interaction foundations, the dashboard, project workspace, persistent dock, forms and loading states. It is not a claim that the entire application is certified against Apple HIG or WCAG. Native Apple presentation patterns are adapted to a browser rather than imitated as a visual skin.

References consulted:

- Apple HIG: https://developer.apple.com/design/human-interface-guidelines
- Apple accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Apple layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Chrome Modern Web Guidance: https://developer.chrome.com/docs/modern-web-guidance
- Chrome guidance setup / Baseline: https://developer.chrome.com/docs/modern-web-guidance/get-started
- Next.js link status: https://nextjs.org/docs/app/api-reference/functions/use-link-status
- Base UI dialog focus behavior: https://base-ui.com/react/components/dialog

Apple's accessibility principles inform perceivable labels, keyboard operation, readable text and preference handling. Chrome's guidance informs native HTML/CSS, progressive enhancement and avoiding redundant client-side infrastructure. The implementation uses existing Next.js and shadcn/Base UI primitives without dependency changes.

## Findings and changes

| Area | Finding in the baseline | Change | Regression coverage |
| --- | --- | --- | --- |
| Keyboard navigation | Loading replaced the main landmark with a status role, and several main targets were not explicitly focusable. | Keep a named main landmark with `tabIndex=-1`; announce loading outside its busy subtree. Dashboard section links are native anchors with focusable destinations. | Skip-link, streaming landmark and section-navigation tests. |
| Dock panels | Manually controlled panel buttons did not expose expanded/controlled state. | Stable `useId` IDs, `aria-haspopup`, `aria-expanded`, and `aria-controls` only while the portal is mounted. | Controlled-dialog relationship and Escape/focus restoration test. |
| Mobile dismissal | The mobile dock drawer had no visible close action. | Compose the existing `DrawerClose` with `Button`, with a safe-area footer; retain swipe and Escape behavior. | Touch drawer close test. |
| Touch operation | Link buttons were not marked like buttons; coarse-pointer rules enforced height but not width. | Shared slot metadata and minimum 44 CSS-pixel targets at a 16px root font; preserve scaling with `rem`. Account for hybrid touch devices using `any-pointer`. | Touch button and link-button bounding-box checks. |
| Form feedback | Project title errors were not connected to the input; the project-type group lacked a name. | Stable label/error IDs, `aria-describedby`, required semantics, named toggle group, busy status and server-error alert. Validation remains RHF + the existing shared Zod schema. | Invalid-submit test asserts association, focus and no write. |
| Narrow layouts | Global horizontal clipping could conceal overflow. Mobile details always used a fixed-height inner scroller. Dashboard section navigation disappeared below desktop width. | Remove global clipping, contain stage/dock scrolling locally, use document scrolling for details below 768px, expose wrapping section navigation. | 320px and 390px overflow checks; mobile/desktop details test. |
| Readability | Supporting text used a lighter neutral token; task detail text was truncated. | Darken the light-theme muted token and allow task details to wrap. Keep existing semantic colors. | Isolated neutral-token calculation; full rendered contrast remains a manual/automated audit item. |
| Dialog bounds | Shared dialogs had no viewport-height constraint or reserved title space for the close control. | Viewport/safe-area-aware maximum height and position, contained scrolling, close-control clearance. Keep the existing `Close` accessible label for compatibility. | Small-viewport submit/close reachability test. |
| Motion and contrast | Several shared animations were outside reduced-motion handling; shadow-only focus is insufficient in forced colors. | Shorten shared UI transitions/animations, preserve positioning transforms and authored composition motion, use solid keyboard outlines and forced-color borders. | Reduced-motion and forced-colors tests. |
| Loading feedback | Links had no local pending cue; empty pipeline content gave no next step. | A delayed, layout-neutral `useLinkStatus` indicator and an explicit empty state pointing to project creation. Preserve native prefetch and streaming. | Existing persistent-dock tests; manual slow-network and empty-state checks. |

The link indicator covers Next `<Link>` transitions. Navigation resumed via the existing dirty-state guard's imperative router call still relies on the route loading fallback. No extra navigation timer, duplicate prefetch request or global loading overlay is introduced.

`viewportFit: "cover"` is paired with workspace and dock safe-area spacing. Actual notch, home-indicator and virtual-keyboard behavior must still be checked on devices, including the app's other routes.

## Validation status

The delivery bundle records results separately from application acceptance:

- The nine original edited files were matched byte-for-byte against their GitHub Git-blob SHA values.
- The patch was checked and applied to those verified originals in a local fixture repository, then compared with the delivered updated files.
- Nine TypeScript/TSX files passed syntax parsing with the locally available TypeScript 5.8.3 parser. This is **not** the repository's TypeScript 7 type check.
- CSS passed PostCSS syntax parsing.
- An isolated Chromium 144 fixture passed 27 CSS checks across 320×400, 390×844 and 1024×600 viewports. These cover CSS target size, dialog bounds, motion preferences, focus outlines and two neutral contrast pairs. The fixture supplies minimal layout utilities and does **not** execute React, Base UI or the application's Tailwind build.
- Ten application Playwright tests were added, but **not executed** in this environment. The existing full suite, Biome, `pnpm typecheck`, production build and CI remain outstanding.

A proposed global `scrollbar-gutter` reservation was removed during CSS validation because it shifted the test dialog's horizontal center. Existing component scroll-lock behavior is retained rather than adding an unverified global override.

During initial bundle preparation, dependency installation was unavailable due to network/DNS access, and the available Node version was 22 rather than the project's Node 24 requirement. That initial remote code-write attempt was blocked before commit creation. These are historical bundle-validation limitations, not the current PR or CI status; consult the PR checks for subsequent results. The submission step rechecked the nine original Git-blob SHAs, reverse/forward patch application, all eleven delivered files and `git diff --check`. No merge or production deployment is authorized by this change.

## Reproduction and acceptance

Use the repository's declared Node and pnpm versions and its existing synthetic testing routes. After reviewing/applying the patch:

```sh
pnpm install --frozen-lockfile
pnpm check:ci
pnpm typecheck
pnpm test:e2e tests/e2e/workspace-modern-ux.spec.ts tests/e2e/workspace-navigation.spec.ts tests/e2e/workspace-dashboard.spec.ts tests/e2e/project-workflow.spec.ts
```

The existing Playwright configuration builds the production testing app and uses Chromium. Passing that command does not establish Safari or assistive-technology acceptance. Run the full repository checks before merge as well.

Manual acceptance still required:

1. Safari/iOS and an Android browser: portrait, landscape, keyboard open, long project names, large task counts, safe areas and nested sheets. Reach the last field and dismiss without relying on a swipe.
2. Keyboard + VoiceOver/NVDA: skip link, current step, panel open/close and focus restoration, field error announcement, dirty-change confirmation and loading completion. Verify route caching does not introduce duplicate active landmarks.
3. 200% text size and 400% desktop zoom: inspect clipping, horizontal scrolling, title wrapping and fixed-dock obstruction. Check dashboard, forms, project details, authentication, video editor and media previews.
4. Light/dark tokens, increased contrast, forced colors, reduced motion and reduced transparency. Inspect real rendered text/control contrast rather than treating neutral-token math as a whole-page audit.
5. Empty/error/slow-network states and business regressions: pipeline empty state, field/server errors, long model/tool forms, draft retention, explicit approvals, publication and send confirmations. No real customer, account or media data is needed.
6. Performance: record production LCP/INP/CLS and bundle/network baselines, then compare on the same device/network. No numerical performance improvement is asserted here.

## Safety and rollout

No server action, authorization function, schema, migration, quotation logic, approval rule, publication or messaging behavior is changed. Existing dirty-state navigation, persistent shell placement, Cache Components and React Compiler configuration are retained. There are no package or lockfile changes.

Review the patch, run the outstanding checks, and keep any eventual PR unmerged until the mobile and keyboard acceptance above is complete. Reverting the UI commit restores the previous behavior without a data migration.
