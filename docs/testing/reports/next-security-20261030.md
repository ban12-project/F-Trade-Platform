# Next.js security refresh — 2026-10-30

Issue #698, parent risk #498. Baseline main: `9ee04dbf41fce3dbd137e6c2d982a7d596c145f3`.

The current production lockfile matched three Next.js advisories: [typed-array cache RCE](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr), [SVG optimization RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw), and [Server Action DoS](https://github.com/advisories/GHSA-p3m5-59mp-jv5r). These are version matches, not proof of an exploited application route. Source search found no explicit `use cache`, `next/image`, or `next/og` usage in app/lib/components; Cache Components remains enabled, and absence of these strings is not an exploitability proof. Upstream recommends upgrading even without known affected cache functions.

Next and @next/playwright move together from 16.3.8 to the published stable 16.4.3. Only their package family and dependent peer keys change in the lockfile. React, TypeScript 7, Workflow, both source patches and all scoped overrides remain unchanged. Cache Components, both compiler flags, default Turbopack and TypeScript CLI remain enabled.

Same-round `pnpm audit --prod --json`:

| Severity | Before | After |
| --- | ---: | ---: |
| Critical | 3 | 1 |
| High | 12 | 11 |
| Moderate | 12 | 12 |
| Low | 6 | 6 |

No Next matches remain. Other advisories stay tracked in #498. Better Auth's critical match requires Magic Link plus OAuth according to its advisory; the current auth configuration uses email OTP, passkey and admin, but this does not clear its other findings or substitute for coordinated package remediation. Historical audit totals must not be presented as current risk counts.

Local validation under Node 24.22.1 and pnpm 12.3.4: frozen lockfile install, TypeScript check, Biome CI (232 warnings / 35 infos, no fixes), existing Workflow replay/data/Buffer/HTTP compatibility, and both actual SDK frozen-state nanoid replay/security tests pass. Fixtures and prior patches are unchanged. Full production build and application/browser regression validation are delegated to the PR's existing required CI; results must be inspected before merge. No production deployment or business/channel acceptance is claimed here.
