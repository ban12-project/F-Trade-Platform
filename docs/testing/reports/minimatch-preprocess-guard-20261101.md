# Installed minimatch preprocessing bounds — 2026-11-01

Related to #498. Current production dependency audit remains **0 critical,
0 high, 1 moderate, 1 low**. The residual advisories are minimatch and deepmerge;
the deepmerge registry latest remains 4.3.1 with no published advisory fix.

[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
describes amplification at optimizationLevel >= 2. Its
[upstream fix](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)
bounds generated patterns and skips quadratic deduplication above 1000 entries.
The published fix is in a later major. This change backports those two guards
to installed 10.2.6 and 9.0.9 CommonJS and ESM distributions without overriding
consumer majors or suppressing audit findings.

Version 10 retains its existing `braceExpandMax` option/default of 100,000.
Version 9 has no such option, so it uses the same fixed 100,000 preprocessing
ceiling without introducing a new public option. Once the ceiling is reached,
additional splitting stops; the original pattern remains available. Above 1000
patterns the pairwise deduplication optimization is skipped. This is not a bound
on every possible matcher cost or arbitrary application input.

The previously recorded callers still use default optimization level 1, so no
new remotely exploitable application path is asserted. This protects the
installed higher-optimization path as well. Installed version 5 has no matching
preprocessing implementation and is unchanged; its version-range audit match
remains. Independent `pnpm dlx` installations do not inherit these patches.

## Verified behavior

Tests resolve the actual shadcn → ts-morph → common and Workflow → nest → SWC
parent chains, and exercise both module formats of their installed minimatch.

- Unpatched baseline: four compatibility cases passed; six boundary cases
  failed. An already-full 100,000-entry preprocessing set grew beyond its cap.
  The adversarial level-2 compile exhausted its bounded child-process heap
  rather than respecting version 10's requested expansion limit.
- Patched: all ten original cases pass. Twenty explicit match expectations at
  optimization levels 0/1/2 cover nested paths, dotfiles, braces, extglobs,
  negation, matchBase, case handling, Windows paths and partial matching.
- The full-budget guard and the >1000-entry no-pairwise-comparison condition are
  checked in both versions/formats. Version 10's adversarial compile is isolated
  in a 128 MiB child with a three-second timeout and produces 64 patterns.
- Two added real-parent cases pass: ts-morph source include/exclude selection,
  and SWC `globSources` filtering explicit source files by an include pattern.
  The first SWC directory-input test returned an empty list on both untouched
  and patched dependencies. It is preserved as a test-fixture limitation; the
  final case tests explicit-file matching, not complete directory discovery.
- Final result: **12/12** new tests, **18/18** existing deepmerge/tooling/URI/HTTP
  tests, and Workflow replay/legacy-data/Buffer/HTTP compatibility passed.
- Frozen installation, TypeScript, targeted Biome and the Next production build
  passed with synthetic test configuration and an unreachable local database.
  The only dependency changes are patch bindings/hashes for the two versions.

The new test is wired into the existing repository validation workflow. Normal
CI pause policy #711 remains unchanged. No model call, account action, source
material or customer record was used. Keep #498 open for upstream releases,
independent-tooling coverage and remaining version advisories; these tests do
not certify arbitrary future consumers or every denial-of-service pattern.

Full repository validation, Markdown links and final diff checks also passed.
