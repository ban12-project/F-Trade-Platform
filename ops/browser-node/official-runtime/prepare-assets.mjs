import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { ensureModel } from "fpgen-js";
import { GEOIP_STORE, publishGeoip } from "./geoip-store.mjs";
import {
  downloadMmdb,
  getMmdbPath,
  needsUpdate,
} from "./node_modules/camoufox/dist/geolocation.js";
import { COMPAT_FLAG, setActive } from "./node_modules/camoufox/dist/multiversion.js";
import { camoufoxPath, installedVerStr } from "./node_modules/camoufox/dist/pkgman.js";
import { getEnvVars } from "./node_modules/camoufox/dist/utils.js";

// Build-time only. The server never fetches a browser or fingerprint model.
const pin = JSON.parse(
  await readFile(
    new URL("./node_modules/camoufox/dist/data-files/browser-pin.json", import.meta.url),
  ),
);
assert.deepEqual(
  pin,
  {
    tag: "v158.0.1-beta.41",
    repo: "daijro/camoufox",
    repo_name: "Official",
    version: "158.0.1",
    build: "beta.41",
  },
  "official_browser_pair_mismatch",
);
// Docker extracts directly into the versioned layout: moving lower-layer
// directories here fails with EXDEV on Docker's overlay filesystem.
const cache = "/root/.cache/camoufox";
const relative = "browsers/official/158.0.1-beta.41";
const installed = `${cache}/${relative}`;
const metadata = JSON.parse(await readFile(`${installed}/version.json`, "utf8"));
assert.equal(metadata.version, "158.0.1");
assert.equal(metadata.release, "beta.41");
await writeFile(
  `${installed}/version.json`,
  JSON.stringify({ ...metadata, interface: 1, prerelease: true }),
);
setActive(relative);
await writeFile(COMPAT_FLAG, "", { mode: 0o600 });
assert.equal(camoufoxPath(), installed);
assert.equal(installedVerStr(), "158.0.1-beta.41");
const driver = JSON.parse(
  await readFile(new URL("./node_modules/playwright-core/package.json", import.meta.url)),
);
assert.equal(driver.version, "1.62.0");
await mkdir("/root/.camoufox", { recursive: true, mode: 0o700 });
await mkdir("/root/camoufox", { recursive: true, mode: 0o700 });
const model = await ensureModel();
await downloadMmdb(undefined, () => {});
assert.equal(await needsUpdate(), false, "geoip_not_current");
const executable = "/root/.cache/camoufox/browsers/official/158.0.1-beta.41/camoufox-bin";
for (const os of ["lin", "mac", "win"]) getEnvVars({}, os, executable);
const geoip = getMmdbPath();
await writeFile(
  "/app/runtime-manifest.json",
  JSON.stringify(
    {
      version: 1,
      browser: "158.0.1-beta.41",
      launcher: "camoufox@0.5.9-beta.6",
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
// The built-in seed supports isolated offline image tests. Production mounts a
// separately updated volume here, read-only and with volume copy-up disabled.
await publishGeoip(GEOIP_STORE, `${cache}/geoip`, { source: "build-seed" });
await rm(`${cache}/geoip`, { recursive: true });
await symlink(`${GEOIP_STORE}/current`, `${cache}/geoip`);
