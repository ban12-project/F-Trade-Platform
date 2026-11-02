---
meta:
  contentType: How-to
---
# Run browser and publication acceptance

Use this guide to validate UI behavior, database writes and live publication separately. It is for maintainers changing the publication flow. The [implementation plan in Issue #805](https://github.com/ban12-project/F-Trade-Platform/issues/805) defines the scope and acceptance conditions. Live account availability and per-post confirmation remain separate requirements.

## Select the evidence layer

Choose the layer that can prove the behavior you changed:

| Layer | Evidence | Does not prove |
| --- | --- | --- |
| Domain tests | Input, evidence, version and authorization rules | Browser interaction or external publication |
| UI scenarios | Selection, preview, blockers, reload and authentication errors | Database persistence or platform acceptance |
| Database acceptance | Durable submissions, atomic targets, concurrent claims and per-account receipts | Actual upload, rendering or Facebook acceptance |
| Authenticated browser integration | Real pages and Server Actions with synthetic local sessions | Real login or business approval |
| Live channel acceptance | Current account, actual media and platform receipt | Other accounts, layouts or future sessions |

## Run isolated UI scenarios

Install Node 24, repository dependencies and Playwright Chromium before running the UI suite. The preflight reports a missing browser before building the application.

Run the focused publication scenarios:

```sh
pnpm test:publication:ui --workers=2 --reporter=line
```

Playwright starts its own server and refuses an occupied port. UI and database suites use separate build directories. Neither suite reuses a development server. Run suites sequentially within one checkout because Next.js still generates the shared, ignored `next-env.d.ts`; use separate checkouts for concurrent runs.

The preflight writes an ignored TypeScript configuration for each layer. Next.js can update that file without changing the repository configuration. Cache Components, React Compiler, Turbopack and the TypeScript CLI check remain enabled.

## Run database acceptance

Provide a dedicated PostgreSQL instance on loopback port 5432 with the synthetic credentials used by the repository fixtures. The database runner accepts only its fixed `f_trade_stream_test` database, checks connectivity and applies migrations through the submission suite. It does not use a saved business `DATABASE_URL`.

Run the text, image and video submission and receipt matrix:

```sh
pnpm test:publication:database
```

The fixtures generate unique identities and references for each run. Media bytes and worker receipts are synthetic; the tests reject external fetches. Failed or unknown receipts must not mark another account successful. Replaying a submitted batch must not create another job.

For real page and Server Action checks, provide the separate `f_trade_browser_test` database and run:

```sh
pnpm exec playwright test --config playwright.database.config.ts
```

A domain database test does not replace an authenticated browser test. Record each layer's result separately, including failures and unexecuted checks.

## Diagnose the first failure

Both browser suites retain a trace and screenshot on failure in separate `test-results/ui` and `test-results/database` directories. Open the failed test's trace from the local test-results directory:

```sh
pnpm exec playwright show-trace path/to/trace.zip
```

Treat traces as private: they can contain requests, cookies and page data. Only synthetic artifacts belong in CI uploads. Local acceptance logs and live screenshots stay in ignored or approved private storage.

Use business identity to locate a record, then assert its controls and status. Do not resolve an ambiguous locator with an arbitrary first match. Wait for observable completion such as a persisted task, decoded preview or receipt; do not add fixed sleeps or increase retries to conceal a failure.

## Enter live channel acceptance

Use the authenticated application's **内容与发布** flow as the live entrypoint. This procedure is not part of the automatic test suite and does not authorize a post:

1. Record the deployed revision, selected account and current login state in private evidence. Stop on login challenges, expired authorization or an account pause.
2. Select one reviewed text, image or video item. Verify its source, rights, current version and preview. Reference factory footage does not establish SKU identity.
3. Record the exact account, public audience, caption and media for review. Obtain the required per-post confirmation before submitting.
4. Submit once through the application. Record the resulting publication and job references privately.
5. Follow that same job until it has a receipt or an explicit unresolved outcome. Verify the canonical platform post, author, text and attached media against the confirmed preview.
6. If the outcome is unknown, use the existing result-reconciliation flow. Do not resubmit. If sending definitely did not occur, return to preview and confirmation before any retry.

Record `passed`, `failed`, `blocked` or `not_run` for each format. A queue record, HTTP success or screenshot of the editor is not a publication receipt. Keep real account names, post links and source files out of Issues and PRs; report only the engineering outcome and a private evidence reference.
