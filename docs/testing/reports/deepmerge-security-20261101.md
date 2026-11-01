# Installed deepmerge prototype guard — 2026-11-01

Related to #498. The installed shadcn dependency deepmerge 4.3.1 can return an
object with an attacker-controlled prototype when given JSON-derived input and
a null-prototype or primitive-placeholder target. Copying an own `__proto__`
key from the target has the same effect. The global Object prototype is not
changed; testing only unrelated objects misses this behavior.

Sources: [advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) and
[upstream report](https://github.com/TehShrike/deepmerge/issues/273).
The maintainer closed the issue without a published patch. This local mitigation
is not an upstream fix or proof that the application was exploitable.

The pnpm patch drops `__proto__` before reading or assigning either target or
source entries, in source, CommonJS and UMD builds. It preserves ordinary keys,
including legitimate own constructor/prototype fields, and existing custom
merge behavior. Arbitrary executable getters, proxies or user-supplied custom
merge callbacks are outside the JSON-input threat model.

## Observed checks

- Both installed CommonJS and bundled UMD prototype tests fail on the unpatched
  package; their compatibility tests pass. The tests resolve shadcn's actual
  installed package, not a separate copy.
- Patched cases cover null-prototype targets, target-owned keys, null/primitive
  placeholders, nested objects, merge.all, array element cloning and clone:false.
  Assertions inspect the returned object's prototype and inherited values.
- Normal nested config fields, arrays, symbols, Dates, customMerge/arrayMerge,
  input immutability and legitimate own constructor/prototype values pass.
- Four deepmerge cases plus eight existing actual-tooling checks pass (12/12),
  including installed shadcn MCP negotiation and a read-only tool call.
- After integrating main's qs/Hono fixes, all fourteen combined cases pass.
  Frozen installation, TypeScript, targeted Biome and production build pass.
  The first build lacked the synthetic Better Auth secret and stopped during
  page collection; the successful run uses the checked-in production-build CI
  environment with a synthetic, unreachable database, not real credentials.

The version-based audit match remains; no advisory is suppressed. Standalone
`pnpm dlx shadcn` does not inherit this workspace patch. Keep #498 open for that
boundary, the missing upstream release and other residual dependencies. No
real account, customer record or external publication was used.
