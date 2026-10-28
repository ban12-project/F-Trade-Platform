import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ensureModel } from "fpgen-js";
import {
  downloadMmdb,
  getMmdbPath,
  needsUpdate,
} from "./node_modules/camoufox/dist/geolocation.js";
import { getEnvVars } from "./node_modules/camoufox/dist/utils.js";

// Build-time only. The server never fetches a browser or fingerprint model.
const pin = JSON.parse(
  await readFile(
    new URL("./node_modules/camoufox/dist/data-files/browser-pin.json", import.meta.url),
  ),
);
assert.ok(JSON.stringify(pin).includes("v158.0-beta.40"), "official_browser_pair_mismatch");
const driver = JSON.parse(
  await readFile(new URL("./node_modules/playwright-core/package.json", import.meta.url)),
);
assert.equal(driver.version, "1.62.0");
await mkdir("/root/.camoufox", { recursive: true, mode: 0o700 });
await mkdir("/root/camoufox", { recursive: true, mode: 0o700 });
const model = await ensureModel();
await downloadMmdb(undefined, () => {});
assert.equal(await needsUpdate(), false, "geoip_not_current");
const executable = "/root/.cache/camoufox/camoufox-bin";
for (const os of ["lin", "mac", "win"]) getEnvVars({}, os, executable);
const geoip = getMmdbPath();
await writeFile(
  "/app/runtime-manifest.json",
  JSON.stringify(
    {
      version: 1,
      browser: "158.0-beta.40",
      launcher: "camoufox@0.5.9-beta.5",
      playwright: driver.version,
      geoipSha256: createHash("sha256")
        .update(await readFile(geoip))
        .digest("hex"),
      modelStamp: (await readFile(`${model}/.pinned-model`, "utf8")).trim(),
    },
    null,
    2,
  ),
);
