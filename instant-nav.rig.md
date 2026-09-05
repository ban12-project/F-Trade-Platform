# Instant navigation rig: F-Trade

- BUILD: `playwright.database.config.ts` builds with `pnpm exec next build` (Turbopack), then serves with `pnpm start` on port 3100. Next and `@next/playwright` are both 16.3.2; Cache Components and both React Compiler flags stay enabled.
- EXPOSE: `NEXT_ENABLE_TESTING_API=1` is passed by the database-browser config at build and serve time. Normal production builds leave this opt-in unset. Never deploy a test build to production.
- RUN: `pnpm exec playwright test --config playwright.database.config.ts project-instant`. The config uses `http://127.0.0.1:3100`, one worker, zero retries, and retained failure traces. Tests cover 1280×800 and 390×844 with real links and direct document loads.
- TEST USER: the spec inserts a randomly named synthetic admin, signed Better Auth session, marketing project and owner membership into `f_trade_browser_test`. The real auth and project access checks run. Cleanup removes only these fixtures. No real accounts or business data are used.
- DRIFT: session validity, role, membership, project kind/status, explicit versus default stage, empty versus populated tasks, database migrations and viewport. This spec pins these inputs; the existing product and sales database-browser tests cover populated workflows.
- LOOP: local build → start → unlocked baseline during development → locked checks → change → rebuild. For the differential restore only the route/component fix, rebuild and require failure, then reapply and rebuild. Playwright refuses an existing server (`reuseExistingServer: false`) and owns/stops its server process. CI runs the same config after the general e2e suite.
- LIVENESS: local fresh build/start; no remote deployment is measured. Port 3100 must be free before each run; a server conflict is a failure, never permission to reuse an unknown build.
- WALLS: PostgreSQL must be running at 127.0.0.1:5432 with synthetic/synthetic and database `f_trade_browser_test` (the CI service already supplies it). The config deliberately overrides saved database/auth credentials. Locally an isolated temporary PostgreSQL cluster can supply this database. Browser launch, listening ports and PostgreSQL shared memory need execution outside the desktop filesystem sandbox. Do not measure with `next dev`.

The lock checks require a real visible header control, gate the project title,
and verify loaded content after release (reload after a locked document load).
They also retain screenshots and check header DOM identity/focus during streaming.
The unlocked development baseline must be removed before shipping.
