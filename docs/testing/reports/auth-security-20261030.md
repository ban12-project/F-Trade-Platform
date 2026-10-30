# Better Auth security refresh — 2026-10-30

Issue #700, parent #498. Baseline main: `19861bbe43f6bd71827c47a01b590760c31ea19e`.

Update better-auth 1.7.1 and @better-auth/passkey 1.7.2 together to exact 1.7.14. Core, telemetry and adapter packages now share 1.7.14; required utility/fetch/better-call dependencies follow upstream. The former duplicate core patch version is removed. Root Zod 4.4.3 and auth-internal Zod 4.5.4 remain unchanged, including their outstanding advisory. Next 16.4.3, Workflow, source patches, auth policy, database schema and migrations are unchanged.

Upstream sources:

- [Magic Link/OAuth purpose isolation](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm): fixed floor 1.7.7; coordinated package upgrade; no user/account schema migration.
- [OAuth Proxy](https://github.com/better-auth/better-auth/security/advisories/GHSA-r4xp-prcw-77qf).
- [PostgreSQL rate-limit race](https://github.com/better-auth/better-auth/security/advisories/GHSA-44jh-23m7-hpcf).
- [Published 1.7.14](https://github.com/better-auth/better-auth/releases/tag/v1.7.14).

Current application config uses emailOTP, passkey and admin, with no Magic Link, social/Generic OAuth, OAuth Proxy or database rate-limit storage. Accordingly, these version matches do not prove the described application exploit prerequisites. Memory rate limiting is not a global distributed limit; this upgrade does not claim to solve that separate limitation.

Same-round production audit changes **1 critical / 11 high / 12 moderate / 6 low → 0 critical / 10 high / 12 moderate / 4 low**. No Better Auth matches remain. Keep #498 open for other packages and unsupported tooling paths.

## Validation and boundaries

Two new real-library tests pass unchanged against both baseline and candidate packages. They invoke Better Auth's HTTP handler with synthetic memory storage and captured OTP delivery, checking wrong-code rejection, successful sign-in/cookie/session lookup, OTP replay denial, sign-out revocation, unknown-user non-delivery/non-creation and disabled password signup. They do not send mail or touch production. Added to repository CI. This proves same-version library behavior on both sides, not replay of an old persisted session into a new library, actual invitation hooks, or a physical Passkey ceremony.

Existing real Drizzle/Passkey schema mapping checks pass. Frozen install and TypeScript check pass under Node 24.22.1 / pnpm 12.3.4. Initial test invocation preceded install completion and failed module resolution; the post-install runs are the valid results. The full production build, browser/database and rollback-reader suites remain required before merge. Deployment and authenticated production acceptance are not yet claimed.
