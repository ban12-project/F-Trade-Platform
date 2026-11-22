# Next.js security refresh — 2026-11-22

Issue [#1094](https://github.com/ban12-project/F-Trade-Platform/issues/1094), parent risk [#498](https://github.com/ban12-project/F-Trade-Platform/issues/498). Baseline `main`: `3cfc530509dbb217908bfb60b9f08d6b298a30d1`.

On `next@16.4.3`, `next build` halted with `SecurityFatalError` and `pnpm audit --prod --json` / the npm bulk advisory endpoint matched seven moderate Next.js advisories (all affecting `<=16.4.4`, patched in `>=16.4.5`):

- [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h): Information disclosure across root params when a `'use cache'` function is called through `unstable_cache()`
- [GHSA-vc7v-qv4w-wrv8](https://github.com/advisories/GHSA-vc7v-qv4w-wrv8): Cache leak across root param values in nested `'use cache'` functions via delayed inner stream metadata
- [GHSA-7qx7-33qx-rqx2](https://github.com/advisories/GHSA-7qx7-33qx-rqx2): SVG rejection bypass in the image optimization
- [GHSA-f3mh-rxg3-f5g2](https://github.com/advisories/GHSA-f3mh-rxg3-f5g2): HttpOnly cookie exposure through internal response header on Next.js Edge runtime routes
- [GHSA-pc58-hwjq-p385](https://github.com/advisories/GHSA-pc58-hwjq-p385): Cross-client response injection and disclosure in self-hosted Next.js applications forwarding fetched responses
- [GHSA-rhh4-g77r-r9qj](https://github.com/advisories/GHSA-rhh4-g77r-r9qj): Cross-user cache disclosure and poisoning in Next.js `use cache` with binary arguments
- [GHSA-vvgp-ww4w-46vf](https://github.com/advisories/GHSA-vvgp-ww4w-46vf): Cache poisoning of shared fallback shells in Cache Components via request-supplied placeholder route params

Source search in `app/`, `lib/`, and `components/` found `next/image` imported in `components/workspace/marketing-video-create-form.tsx` and `components/workspace/publication-composer.tsx`, and `cacheComponents: true` is enabled in `next.config.ts`; no explicit `"use cache"` directive, `unstable_cache`, `next/og`, or `runtime = "edge"` strings appeared. Version matches are not exploitability proofs, and absence of specific strings is not proof of non-reachability; upgrading to the published stable release removes all seven matches.

`next` and `@next/playwright` move together from `16.4.3` to exact `16.4.6`. Only the `next`, `@next/env`, `@next/playwright`, and `@next/swc-*` package family and dependent peer keys (`@better-auth/passkey`, `@workflow/next`, `better-auth`, `workflow`) change in `pnpm-lock.yaml`. React (`19.2.8`), TypeScript (`7.0.2`), Workflow (`5.3.0`), `@vercel/blob` (`2.8.0`), `ai` (`7.0.77`), and all overrides and patches in `pnpm-workspace.yaml` remain unchanged. `cacheComponents: true`, `partialPrefetching: true`, `reactCompiler: true`, `experimental.turbopackRustReactCompiler: true`, default Turbopack, and TypeScript CLI checking remain enabled.

Same-round `pnpm audit --prod --json` (and identical totals for full `pnpm audit --json`):

| Severity | Before | After |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 0 | 0 |
| Moderate | 8 | 1 |
| Low | 0 | 0 |

Zero Next.js matches remain (and npm's bulk advisory endpoint returns `{}` for `next@16.4.6` and `@next/playwright@16.4.6`). The single remaining moderate entry is `minimatch` ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)), which remains locally patched in `pnpm-workspace.yaml` (`patches/minimatch@10.2.6.patch`, `patches/minimatch@9.0.9.patch`) and tracked in `#498`.

Local validation under Node `v26.13.0` and `pnpm 12.3.4`: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm check` (1219 files), `pnpm test:workflow-runtime` (10/10 fresh v5 runtime tests + legacy security/serde/nanoid replay suites), `scripts/validate_repository.py` (including `Next.js security release readiness`, `service adapters`, and local Markdown links), `CI=1 pnpm build < /dev/null` (completed with zero `SecurityFatalError` or upgrade warnings and 63/63 static/PPR routes generated), and `PLAYWRIGHT_PORT=3127 pnpm test:e2e tests/e2e/browser-viewer-gateway.spec.mjs --reporter=list < /dev/null` (1/1 passed in Chromium against `next build:test` + `next start`, using alternate port `3127` because port `3000` had an unrelated local socket listener). Remaining CI Playwright specs, PostgreSQL integration suites, and production Vercel deployment (`#982`) were not executed here; no production deployment or business/channel acceptance is claimed.

Marketing video creative review does not apply: this dependency security patch makes no changes to marketing video content, scripts, storyboards, captions, branding, prompts, or product facts.
