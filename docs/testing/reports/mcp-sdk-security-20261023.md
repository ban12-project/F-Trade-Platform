# MCP tooling SDK update — 2026-10-23

Related risk: #498. This is an engineering dependency checkpoint, not business or channel acceptance. DM remains paused.

## Scoped change

The installed path is `shadcn@4.19.1 → @modelcontextprotocol/sdk@1.31.0`. Update only that parent-scoped override to `1.32.0`. The package's dependency and peer dependency declarations and its resolved snapshot dependencies were compared and are unchanged. Lockfile changes are limited to the override, SDK version/integrity, snapshot key and shadcn reference.

The first install also moved the application Zod importer from 4.4.3 to 4.5.4. That unrelated change was removed: the original importer/peer resolutions were restored while retaining the newly generated SDK identity and integrity. A frozen installation then passed the supply-chain policy and restored application Zod 4.4.3. Application package.json, existing Workflow/esbuild overrides and source patches are unchanged.

## Applicability and boundaries

The application source scan found no MCP SDK imports, HTTP MCP server, bearer middleware or experimental task store. The installed shadcn CLI imports and instantiates `StdioServerTransport`. This does not establish an externally exploitable application route.

- [Cross-origin redirect advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw): affects HTTP transports and OAuth client calls; 1.32.0 restricts redirects by default. A direct SDK regression is included even though the observed CLI uses stdio.
- [Experimental task ownership advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-22jm-h49p-29qw): requires a shared task store in an HTTP server. No such application configuration was found.
- [Validation resource advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453): HTTP servers need the explicit `maxToolInputElements` option in addition to upgrading. No HTTP server is configured here; this update does not claim to enable that option.
- [Bearer audience advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-rvq5-wwqv-78pq): an HTTP server needs `expectedResource` and the token audience returned by its verifier. No such middleware is configured here; upgrading alone is not audience-validation evidence.

## Observed validation

Node 24.21.0 / pnpm 12.3.4. Two local HTTP listeners used only marked synthetic credentials. The old SDK followed a 307 to the other origin: the negative test failed with one received request instead of zero. With the final SDK, the intended token endpoint receives its single synthetic credential request, the other origin receives none, and the redirected exchange rejects. A same-origin 307 still completes successfully.

All eight tooling compatibility tests pass: CJS/ESM loader and maps, restricted esbuild origin response, issuer isolation, cached-discovery isolation, legitimate token storage, both redirect controls and actual installed shadcn MCP negotiation/read-only call. Biome CI and TypeScript checks pass. Final production/build/browser compatibility remains subject to the PR's final-head CI.

Same-round `pnpm audit --prod --json`: **0 critical / 3 high / 2 moderate → 0 critical / 1 high / 0 moderate**. These are advisory/version matches, not exploit counts. The remaining braces advisory is still matched; its installed depth guard and the separate unpatched standalone CLI risk remain as documented. **Keep #498 open.** No production credentials, customer data, business writes or account sessions were used.

## CI delivery checkpoint

PR #657 final head `c5b6df5eca3ff9864c9f84758f700bc83c85f7a1` passed every check, including production build and full browser workflow `39817574017`. Squash merge: `365d4c68022b1bb32c983413c4d4a6e7a5fa9055`. This is tooling compatibility evidence, not a new channel or business acceptance result. Risk #498 remains open.
