# Bounded Zod parsing — 2026-10-30

Issue #702, parent #498. Candidate follows the Better Auth patch in #701.

The root and compatible transitive Zod 4 dependencies move to 4.6.7. Eleven exact-parent overrides cover the existing Remotion, Workflow and Vercel CLI pins without changing their package versions or the existing Workflow/nanoid/braces patches. The changed better-call peer context deduplicates its already-compatible utility/fetch dependencies. Zod 3 consumers remain on their original major.

[Upstream patch](https://github.com/colinhacks/zod/commit/a0ebf97) rejects oversized bounded collections before visiting elements. It does **not** add bounds to unbounded schemas. Earlier advisory prose describing unbounded arrays must not be used to claim that this patch limits all inputs. Application limits and field/source validation are preserved.

## Verified behavior

Three regressions fail against the baseline: application/auth arrays visit all 16 invalid elements despite max(2), and the actual product OE model produces 102 issues for 101 invalid values despite max(100). Candidate yields early rejection and a single upper-bound issue. Expanded tests verify the installed Zod resolution of all eleven pinned parents, synchronous/asynchronous parsing, sets, valid input, intentionally unchanged unbounded behavior and actual OE model strictness.

Sixteen candidate tests pass. Actual Workflow queue date coercion/namespace/rejection and CLI config passthrough/invalid-value behavior also pass against baseline packages. Existing actual frozen SDK replay, RNG/token preservation, wire/Buffer/HTTP compatibility, OTP/session tests and AI SDK streamed product validation pass without fixture changes. These are synthetic local checks, not production business acceptance. Full CI and deployment remain pending.

## Residual risks — do not claim whole-graph remediation

The candidate audit is **0 critical / 10 high / 12 moderate / 4 low**, unchanged from the auth candidate count because the same Zod advisory still matches Zod 3.25.76 under shadcn/MCP/zod-to-json-schema. No Zod 3 major override was introduced.

More importantly, @remotion/studio-protocol 4.0.520's published `dist/index.cjs` embeds Zod 4.4.3 mini code; a dependency override cannot replace bundled source. Its payload schema includes a dependency-array upper bound, so installed-dependency tests alone are not proof of bundle remediation. The currently published protocol 4.0.539 still declares Zod 4.5.4; no upstream fixed bundle is claimed. Other Remotion bundles require the same source-level inventory. Keep #702/#498 open for these findings, reachability assessment and a separately verified upstream/bundle remedy.

The override checks intentionally exercise dependency resolutions. They must not be described as proving that every consumer uses the patched parser internally. No unsafe production payload or memory-exhaustion test was sent.
