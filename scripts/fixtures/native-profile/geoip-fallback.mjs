import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Exercise the actual patched launch function in the built browser image.
const source = readFileSync(process.env.FTRADE_TEST_SERVER_PATH ?? "/app/server.js", "utf8");
const match = source.match(
  /async function buildLaunchOptionsWithGeoipFallback\(baseOptions, attemptMeta\) \{[\s\S]*?\n\}/,
);
assert.ok(match, "expected pinned launch function");
const fn = match[0];
const failure = new Error("synthetic GeoIP failure");
let calls = [];
const launch = runInNewContext(`(${fn})`, {
  launchOptions: async (options) => {
    calls.push(options);
    if (options.geoip) throw failure;
    return { fallback: true };
  },
  withTimeout: (promise) => promise,
  GEOIP_SETUP_TIMEOUT_MS: 10000,
  isCamoufoxGeoipError: (error) => error === failure,
  log: () => {},
});

await assert.rejects(
  launch({ proxy: { server: "http://proxy.example:3128" }, geoip: true }, {}),
  (error) => error === failure,
);
assert.equal(calls.length, 1, "a proxy GeoIP failure must not retry without GeoIP");
calls = [];
assert.equal((await launch({ geoip: true }, {})).fallback, true);
assert.deepEqual(
  calls.map((options) => options.geoip),
  [true, false],
);
console.log("PASS proxy GeoIP failure is closed; direct fallback remains unchanged");
