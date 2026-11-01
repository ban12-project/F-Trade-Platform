import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertGeoipReady,
  pruneGeoip,
  refreshGeoip,
  rollbackGeoip,
} from "../ops/browser-node/official-runtime/geoip-store.mjs";

test("GeoIP publishes coherent snapshots, refuses failures and preserves validated rollback", async () => {
  const root = await mkdtemp(join(tmpdir(), "geoip-store-"));
  const store = join(root, "store");
  const source = join(root, "download");
  try {
    await mkdir(source);
    await writeFile(join(source, "data"), "first");
    const download = async () => ({ directory: source, metadata: { synthetic: true } });
    await assert.rejects(assertGeoipReady(store));
    await refreshGeoip(store, download);
    const first = await assertGeoipReady(store);
    await writeFile(join(source, "data"), "second");
    await refreshGeoip(store, download);
    const second = await assertGeoipReady(store);
    assert.equal(second.previous, first.current);
    assert.equal(await readFile(`${store}/current/data`, "utf8"), "second");
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(
        refreshGeoip(store, async () => {
          throw new Error("download_failed");
        }),
      );
      await assert.rejects(assertGeoipReady(store), /not_ready/);
      assert.equal(await readlink(`${store}/current`), second.current);
    }
    await assert.rejects(
      rollbackGeoip(store, async () => {
        throw new Error("expired");
      }),
      /expired/,
    );
    await assert.rejects(assertGeoipReady(store));
    await rollbackGeoip(store, async (directory) => {
      assert.equal(await readFile(`${directory}/data`, "utf8"), "first");
    });
    assert.equal((await assertGeoipReady(store)).current, first.current);
    await refreshGeoip(store, download);
    await pruneGeoip(store);
    await assert.rejects(readFile(`${store}/${second.current}/data`), { code: "ENOENT" });
    assert.equal(await readFile(`${store}/${first.current}/data`, "utf8"), "first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
