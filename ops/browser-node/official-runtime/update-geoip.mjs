// Runs only in the separate, resource-bounded updater. No profile is mounted.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { Reader } from "maxmind";
import {
  assertGeoipReady,
  GEOIP_STORE,
  pruneGeoip,
  refreshGeoip,
  rollbackGeoip,
} from "./geoip-store.mjs";

const day = 86400000;
async function validate(directory) {
  const databases = (await readdir(`${directory}/mmdb`)).filter((name) => name.endsWith(".mmdb"));
  assert.ok(databases.length > 0, "geoip_database_missing");
  const hashes = {};
  for (const name of databases) {
    const bytes = await readFile(`${directory}/mmdb/${name}`);
    const reader = new Reader(bytes);
    const age = Date.now() - reader.metadata.buildEpoch.getTime();
    assert.ok(age >= -300000 && age <= 8 * day, "geoip_database_expired");
    hashes[name] = createHash("sha256").update(bytes).digest("hex");
  }
  return { hashes, checkedAt: Date.now() };
}

const mode = process.argv[2] ?? "update";
assert.ok(["update", "check", "rollback"].includes(mode));
if (mode === "check") {
  await assertGeoipReady();
  await validate(`${GEOIP_STORE}/current`);
} else if (mode === "rollback") {
  await rollbackGeoip(GEOIP_STORE, validate);
} else {
  let recent = false;
  try {
    const status = await assertGeoipReady();
    await validate(`${GEOIP_STORE}/current`);
    recent = Date.now() >= status.checkedAt && Date.now() - status.checkedAt < day;
  } catch {}
  if (!recent) {
    const temporary = await mkdtemp("/tmp/ftrade-geoip-");
    try {
      await refreshGeoip(GEOIP_STORE, async () => {
        // Set before importing the official paths module. Only the updater's
        // temporary cache is writable; browser/model assets are never fetched.
        process.env.XDG_CACHE_HOME = temporary;
        const { downloadMmdb, GEOIP_DIR } = await import(
          "./node_modules/camoufox/dist/geolocation.js"
        );
        await downloadMmdb(undefined, () => {});
        return { directory: GEOIP_DIR, metadata: await validate(GEOIP_DIR) };
      });
      await pruneGeoip(GEOIP_STORE);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
console.log(JSON.stringify({ geoip: mode, ready: true }));
