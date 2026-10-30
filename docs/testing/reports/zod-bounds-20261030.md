# Bounded Zod parsing — 2026-10-30

Issue #702, parent #498; baseline main includes Better Auth #701.

Root and compatible transitive Zod 4 move to 4.6.7. Eleven exact-parent overrides cover existing Remotion, Workflow and Vercel CLI pins without changing parent versions or existing Workflow/nanoid/braces patches. The better-call peer context deduplicates already-compatible utility/fetch dependencies. Zod 3 consumers retain their major.

[Upstream patch](https://github.com/colinhacks/zod/commit/a0ebf97) checks leading collection upper bounds before visiting elements. It does not constrain unbounded schemas. Application field/source validation and existing limits remain intact.

## Installed dependency validation

Three regressions fail on baseline: application/auth arrays visit 16 invalid elements despite max(2), and the actual OE model emits 102 issues for 101 invalid values despite max(100). Candidate rejects early with one upper-bound issue. Sixteen tests cover application/auth and all eleven exact-parent resolutions, synchronous/asynchronous arrays, sets, valid values, deliberately unchanged unbounded behavior, actual OE strictness, actual Workflow queue date/namespace behavior and CLI configuration passthrough/rejection. Queue/config compatibility also passes on baseline.

Existing actual frozen SDK replay, RNG/token preservation, wire/Buffer/HTTP compatibility, OTP/session tests and AI SDK streamed product validation pass unchanged. Frozen install, TypeScript and Remotion composition bundling pass locally. Full final-head CI and deployment remain required.

## Embedded Remotion parser — separately guarded

Dependency overrides alone were insufficient: studio-protocol 4.0.520's CJS/ESM distributions embed Zod 4.4.3 mini. Its element dependency-array schema permits at most 100 packages but visits the list before rejecting it. Installed Remotion dist-file source-marker inventory found this embedded implementation in the protocol's two distributions; marker inventory is not a universal proof that no other package bundles a parser.

A scoped pnpm source patch now checks that same 100-item limit before the bundled element parser runs. The object payload entry rejects before serialization; the JSON drag entry checks after JSON decoding and before element traversal. Malformed/non-array inputs continue through original validation. Raw JSON decoding remains necessary, and this is not a general request-size limit or a replacement of all embedded Zod code.

Four tests fail on unpatched actual published CJS/ESM modules: each object/drag entry reads oversized list elements. All six tests pass with the patch: oversized inputs read zero elements; valid 0/100-package payloads, malformed JSON/null/non-array inputs and forbidden dependency validation retain behavior. Tests instrument synchronous reads and restore JSON.parse in finally; they do not replace the validator or send network requests. No large/OOM payload is used. Both actual distributions are loaded through their published files. The patch is included by the existing Harbor patches-directory copy/allowlist.

Production source imports @remotion/vercel for controlled composition rendering; inspected protocol consumers are Studio authoring routes. This is package-level remediation, not evidence of a reachable unauthenticated production exploit or proof of rendered-video/business acceptance.

## Remaining risk

Fresh candidate audit: **0 critical / 10 high / 12 moderate / 4 low**. Zod's remaining reported match is 3.25.76 under shadcn/MCP/zod-to-json-schema. Standalone tooling does not inherit project patches. Keep #498 open; no cross-major override, vulnerability-free graph or global collection limit is claimed. The Remotion package still contains old parser code, with the identified bounded dependency-list entry points protected by the source patch; a future upstream replacement must preserve these tests before removing it.
