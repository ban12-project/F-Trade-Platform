// Operator-only, offline verification of a restored account copy. Never mount an original.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { startDisplay } from "/app/official-runtime/display.mjs";
import { createOfficialLauncher } from "/app/official-runtime/launcher.mjs";
import { Camoufox, launchOptions } from "/app/official-runtime/node_modules/camoufox/dist/index.js";

const config = JSON.parse(readFileSync("/run/copy-case.json", "utf8"));
assert.ok(isIP(config.expectedEgressIp));
const owner = JSON.parse(readFileSync("/data/native-profile-v1/owner.json", "utf8"));
assert.equal(owner.accountId, config.id);
assert.equal(owner.nodeId, config.nodeId);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let display, context;
let stage = "launch";
try {
  display = await startDisplay();
  const launcher = createOfficialLauncher({
    root: "/data",
    leaseDeadline: () => Date.now() + 120000,
    display: display.display,
    executablePath: "/root/.cache/camoufox/browsers/official/158.0.1-beta.41/camoufox-bin",
    proxy: { server: "http://127.0.0.1:9", username: "", password: "" },
    // Offline storage gate only: use the exit already verified by the separate real-proxy gate.
    // Production continues to require geoip:true and a live proxy lookup.
    official: {
      Camoufox,
      launchOptions: (options) => launchOptions({ ...options, geoip: config.expectedEgressIp }),
    },
  });
  await launcher.ensureBrowser(60000);
  context = await launcher.contextFor(config.id);
  stage = "cookies";
  const cookies = await context.cookies("https://www.facebook.com/");
  const users = cookies.filter((c) => c.name === "c_user");
  const actors = cookies.filter((c) => c.name === "i_user");
  console.log(
    JSON.stringify({
      cookieCount: cookies.length,
      userCookieCount: users.length,
      expectedIdentityMatches: users.some((c) => digest(c.value) === config.expectedIdentityDigest),
      actorIdentityMatches: actors.every((c) => digest(c.value) === config.expectedIdentityDigest),
    }),
  );
  assert.equal(users.length, 1);
  assert.equal(digest(users[0].value), config.expectedIdentityDigest);
  assert.ok(actors.every((c) => digest(c.value) === config.expectedIdentityDigest));
  const cookieDigest = digest(
    cookies
      .map((c) => [c.domain, c.path, c.name, c.value])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
  stage = "indexeddb";
  await context.route("**/*", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>SYNTHETIC offline account-copy verification</title>",
    }),
  );
  const storage = [];
  for (const origin of ["https://www.facebook.com", "https://www.messenger.com"]) {
    const page = await context.newPage();
    await page.goto(`${origin}/__ftrade_offline_profile_check__`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    assert.equal(await page.title(), "SYNTHETIC offline account-copy verification");
    const databases = await page.evaluate(async () => {
      if (typeof indexedDB.databases !== "function")
        throw new Error("database_inventory_unavailable");
      const names = await indexedDB.databases();
      if (names.length > 100) throw new Error("database_limit");
      const inventory = [];
      for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open(entry.name);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(new Error("database_open_failed"));
          r.onupgradeneeded = () => {
            r.transaction.abort();
            reject(new Error("unexpected_database_creation"));
          };
        });
        try {
          const stores = [...db.objectStoreNames].sort();
          if (stores.length > 100) throw new Error("store_limit");
          const counts = await Promise.all(
            stores.map(
              (name) =>
                new Promise((resolve, reject) => {
                  const r = db.transaction(name, "readonly").objectStore(name).count();
                  r.onsuccess = () => resolve([name, r.result]);
                  r.onerror = () => reject(new Error("store_count_failed"));
                }),
            ),
          );
          inventory.push({ name: entry.name, version: db.version, counts });
        } finally {
          db.close();
        }
      }
      return inventory;
    });
    storage.push({ origin, databases });
    await page.close();
  }
  const databaseCount = storage.reduce((n, o) => n + o.databases.length, 0);
  assert.ok(databaseCount > 0, "existing_indexeddb_required");
  const result = {
    cookieDigest,
    storageDigest: digest(storage),
    cookieCount: cookies.length,
    databaseCount,
    accountIdentityMatches: true,
  };
  stage = "restart-comparison";
  const baseline = "/data/ftrade-copy-acceptance.json";
  if (existsSync(baseline)) assert.deepEqual(result, JSON.parse(readFileSync(baseline, "utf8")));
  else writeFileSync(baseline, JSON.stringify(result), { mode: 0o600, flag: "wx" });
  await context.close();
  context = null;
  console.log(
    JSON.stringify({
      copyOnly: true,
      networkDisabled: true,
      accountIdentityMatches: true,
      cookieCount: result.cookieCount,
      databaseCount,
      passed: true,
    }),
  );
} catch {
  console.error(JSON.stringify({ copyOnly: true, passed: false, stage }));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await display?.close().catch(() => {});
}
