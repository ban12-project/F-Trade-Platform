# URI and IP parser security patches — 2026-11-01

Parent #498. Baseline main `ffbb001` reports 0 critical, 1 high, 6 moderate
and 3 low advisory matches. This is a fresh audit, not a correction of earlier
historical scans or proof of application exploitability.

Three exact-parent overrides update Ajv 8.20.0's fast-uri to 3.1.9 and SOCKS
2.8.9 / express-rate-limit 8.7.0's ip-address to 10.7.4. Parent versions,
application Zod, Workflow and existing patches remain unchanged. Lockfile
resolution also records upstream's new deprecation metadata for unchanged
@smithy/core 3.33.3; no Smithy upgrade is included.

Sources: [fast-uri advisory](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)
and [ip-address advisory](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5).
The first patch rejects encoded URI schemes. The second removes quadratic work
when rejecting zone strings with repeated percent signs and a line terminator.

## Observed verification

- The baseline fails three new cases: encoded schemes are promoted, and both
  actual parent IP parsers exceed a 1.5-second child-process deadline on an
  80 KB synthetic input. Local schema-reference compatibility passes.
- Patched parsers and eight existing tooling compatibility cases pass: 12/12.
  Tests resolve actual dependencies from Ajv, SOCKS and MCP's rate limiter,
  retain IPv4/IPv6/zone handling, and exercise installed shadcn tool negotiation.
- The first candidate test incorrectly expected URI resolve to return a safe
  value; the patched package correctly throws a malformed-scheme error. The
  assertion now requires that rejection. The initial failing check is not
  counted as passed.
- TypeScript and targeted Biome checks pass. The regression is included in
  the retained repository validation workflow; automatic general CI remains
  paused under #711.
- Fresh patched audit: **0 critical / 1 high / 3 moderate / 1 low**. Remaining
  matches are Zod 3 tooling, @hono/node-server, qs, minimatch and deepmerge.
  Keep #498 open; no cross-major Zod override or vulnerability-free claim.

Frozen installation, the production Turbopack build (including TypeScript),
production fixture/anonymous-workspace boundaries and MVP acceptance-summary
contracts passed locally. Production deployment remains unverified.
No customer data, account operation, external publication or DM is exercised.
