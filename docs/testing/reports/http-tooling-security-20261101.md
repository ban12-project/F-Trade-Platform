# HTTP tooling dependency security patches — 2026-11-01

Parent #498. Exact-parent overrides update Express 5.2.1's qs to 6.16.1
and MCP SDK 1.32.0's @hono/node-server to 2.1.3. These are tooling
dependencies; the advisory matches alone do not establish production exposure.

Sources: [qs advisory](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)
and [Hono adapter advisory](https://github.com/advisories/GHSA-rmxm-3fg6-px4f).
The fixes reject unsafe comma serialization behavior and align static-file
path decoding with authorization middleware.

## Verification

- Tests resolve the installed dependencies through shadcn's MCP SDK and Express,
  rather than separately installed test copies. Both new cases fail before the
  overrides: qs throws on a non-callable own toString property; the malformed
  static path returns synthetic protected content with HTTP 200.
- After patching, both cases and eight existing tooling compatibility tests
  pass (10/10). Normal nested query parsing, comma serialization, public static
  files and protected ordinary/encoded paths remain covered.
- Frozen installation, TypeScript, targeted Biome, production Turbopack build
  and production fixture/anonymous-workspace authorization boundaries pass.
- The new tests are included in the retained repository-validation workflow.
  General automatic CI remains paused under #711.
- Fresh audit: **0 critical / 1 high / 1 moderate / 1 low**, reduced from
  0 / 1 / 3 / 1. Remaining matches are tooling Zod 3, minimatch and deepmerge.
  Keep #498 open: cross-major overrides require separate compatibility work;
  deepmerge has no patched version in this audit.

All exploit-shaped inputs and static files are local synthetic fixtures. No
customer records, real accounts, publishing or DM operations are involved.
Local checks do not establish deployment or end-to-end business acceptance.
