# Tooling systeminformation boundary checks

Issue #708. Scoped `@dotenvx/dotenvx@1.75.1>systeminformation` from 5.33.6 to 5.33.16; parent and all other package versions remain unchanged. This tooling dependency is reached through shadcn. The inspected dotenvx caller invokes `system()` and `osInfo()`, not the affected services/networkStats APIs; this is not evidence of a reachable production exploit.

Sources: [Windows service quoting](https://github.com/advisories/GHSA-3f7j-7jwc-fxfj), [BSD interface cache](https://github.com/advisories/GHSA-7648-jmwf-vw7j), [Linux interface traversal](https://github.com/advisories/GHSA-4vjg-vx72-qq4g).

Local Node 24.22.1 verification:

- Before upgrading, all four Unicode quote boundary assertions failed; valid service lookup passed. With the scoped patch, all eleven checks passed: four quote variants; service name/wildcard/callback handling; Linux traversal rejection before filesystem/shell access; valid Linux counters/callback; all three BSD interface-cache prototype checks; actual dotenvx read-only caller contract.
- OS-specific branches execute the installed package source with intercepted OS responses. No command-injection payload is executed and no interface path is read from the host. These are simulated branch tests, not native Windows/BSD/Linux acceptance. The actual dotenvx method runs locally without constructing a session store or logging host identifiers.
- The first added caller test used the wrong package-relative path and failed module resolution. Correcting the test path yielded the passing result above; no application workaround was added.
- Eight existing tooling compatibility checks, TypeScript, targeted Biome and frozen-lockfile installation passed. Three compatibility cases initially failed because the sandbox prohibited loopback listening; rerunning with local socket access passed without source changes.
- Current audit: 0 critical, 1 high, 5 moderate, 3 low. No systeminformation advisory remains; #498 stays open for residuals. Audit counts do not establish exploitability.

The regression is wired into the retained repository-validation workflow. Per the user's subsequent #711 instruction, automatic CI is paused until final MVP1 acceptance; this change does not claim final-head CI or business acceptance. Automatic deployment remains enabled and is separate evidence.
