# Bounded workspace accessibility audit — 2026-11-01

Related to #391; this does not close physical-device or assistive-technology
acceptance. Browser zoom remains removed from MVP1, as requested.

## Observed failures and repair

The baseline Chromium production-build scan covered `/auth` and six synthetic
routes: workspace-dashboard, project-workflow, product-field-evidence,
product-media, video-workspace and business-closure, in light and dark themes.
Of 14 scans, 11 passed and 3 failed, without retries:

- Product media: two unnamed select triggers in both themes. Link their existing
  visible FieldLabels to explicit trigger IDs.
- Product media: eight checkbox roles lacked names before hydration. Base UI's
  hidden input has the supplied ID, while its visible role acquires label text
  during a layout effect. Add explicit `aria-labelledby` pointing at existing
  visible labels so server-rendered controls are named too.
- Light media: destructive alert text and button text measured about 4.49:1 and
  4.00:1. Dark auth: small footer text measured 3.71:1. Darken the light-theme
  destructive token and increase the footer text opacity.

The new `@axe-core/playwright` 4.14.0 development dependency is imported only by
browser tests, not application components. Tests scan WCAG A/AA rule tags and
attach both violations and incomplete checks. A separate test holds all Next
JavaScript requests and verifies the two select names and eight checkbox names
before hydration; it does not hide the timing defect by waiting for effects.

## Verification

The production-build run passed all 26 cases with zero skips, failures or retries:
14 theme/route scans, one pre-hydration naming case, and the existing 11
workspace-modern-ux cases. All 14 axe attachments had empty violations and
incomplete arrays. This covers the rendered default states of those fixtures,
not every dialog, input state or production record.

Running `next dev` verification independently showed both select names and all
checkbox names in the browser accessibility snapshot. Next MCP reported no
compilation or browser session errors, and the media form screenshot was
inspected. React-tree inspection returned only a completion marker, so no
component-tree introspection result is claimed. The dev server and browser
session were closed before the production test run.

TypeScript and targeted Biome checks pass; Biome reports 11 existing CSS
`!important` warnings in preference overrides. The peer check reports the same
existing `@hookform/resolvers` / `ajv-formats` mismatch on untouched main and the
candidate, with no new axe-related mismatch. Do not describe the peer check as
clean. The Next-generated AGENTS heading normalization is retained per repository
instructions.

## Remaining limits

Keep #391 open for physical iOS/Android software-keyboard and safe-area behavior,
VoiceOver/NVDA announcements and focus behavior, broader full-page contrast and
preference coverage, and controlled production performance measurements if making
performance claims. Automated scans are not a WCAG certification. No production
business records, account actions or real customer data were used.

After rebasing onto main `1dc8c88` (including #768/#769), the production-build
26-case regression passed again without failures, skips or retries; all 14 axe
attachments still have zero violations and incomplete checks. Full repository
validation also passed. Cache Components, both React Compiler settings, default
Turbopack and project-local TypeScript checking remain enabled.
