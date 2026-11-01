# shadcn supported Zod 4 migration — 2026-11-01

Related to #498. Upgrade the installed shadcn tool from 4.19.1 to exactly 4.22.0.
Its published npm manifest supports Zod ^4.2.0 and MCP SDK ^1.32.0, unlike the
previous tool's Zod 3 requirement. This removes the vulnerable major through
the parent's supported migration, rather than overriding Zod 3 with Zod 4.
No UI components, presets or application schemas are replaced.

The new lock resolves shadcn and its MCP SDK to Zod 4.6.7. MCP SDK naturally
resolves to 1.32.2 and its Hono adapter to 2.1.5; remove the obsolete exact-parent
SDK 1.32.0 and Hono overrides. Their security compatibility tests remain active.
Other parser, loader and Workflow overrides remain.

Version selection is deliberate: registry metadata shows 4.23.0 moves to the
split MCP server 2.x package. An initial install resolved that newer tool despite
the requested range; existing SDK compatibility tests failed at module loading.
The final package entry is exact 4.22.0, in its original dependency category,
and the final frozen lock resolves that version. No tests were removed to make
the newer interface pass. A future MCP 2 migration needs its own compatibility
work. Metadata was read with `pnpm view shadcn@4.22.0 dependencies --json` and
the corresponding 4.23.0 query against the public npm registry.

## Observed verification

- Before upgrading, a constrained array from shadcn's actual Zod 3.25.76 visits
  all 16 invalid elements despite a maximum of two; the new zero-visit assertion
  fails. The shared collection-bound suite now checks both actual shadcn and
  MCP resolutions; after upgrading all 18 cases pass.
- All 31 existing tooling, HTTP adapter, URI/IP, brace-depth and systeminformation
  cases pass, including MCP negotiation and the existing read-only tool call.
- Frozen installation, TypeScript, targeted formatting and the production
  build with the standard synthetic CI environment pass. No real database or
  channel account is used. CLI `info` also confirms the existing Base UI /
  base-nova project configuration; it does not modify components.
- Fresh version-based audit reports **0 critical / 0 high / 1 moderate / 1 low**.
  Remaining matches are minimatch and deepmerge. The separate deepmerge patch
  in PR #744 is not included in this branch, and a local patch does not remove
  the advisory's version match anyway.

Keep #498 open. This does not establish that untrusted business input previously
reached the tooling parser, nor does it validate every independently downloaded
CLI or remove all residual dependency risks. General automatic CI stays paused
under #711; final MVP acceptance still requires restored CI and its other gates.

## Remaining minimatch advisory: observed call sites

[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
describes globparts amplification at optimizationLevel >= 2; its version range
matches installed minimatch 5.1.9, 9.0.9 and 10.2.6. Inspecting the installed
JavaScript after this upgrade found:

| Parent | Observed call | Boundary |
| --- | --- | --- |
| @vercel/queue 0.3.1 | matchesFunctionsPattern uses minimatch(sourceFile, pattern) | No options argument; this is source-file route mapping |
| @ts-morph/common 0.27.0 | Two minimatch(path, pattern) calls | No options argument |
| @oclif/core 4.11.4 | Plugin dependency names matched with minimatch(p, w) | No options argument |
| @swc/cli 0.8.1 | Source include/exclude calls use minimatch(filename, pattern) | No options argument |
| filelist 1.0.6 | minimatch.match(files, pat, opts or empty object) | Options are forwarded; installed minimatch 5 has no firstPhasePreProcess/optimizationLevel implementation |

The inspected minimatch 9/10 code defaults optimizationLevel to 1 and enters
first-phase amplification only at >= 2. Thus these observed default-option
call sites do not enable the documented trigger. This is a scoped reachability
finding, not proof of safety for arbitrary future consumers/options or other
denial-of-service patterns. The audit match is not suppressed and #498 remains
open pending an upstream compatible update or a separately verified migration.
