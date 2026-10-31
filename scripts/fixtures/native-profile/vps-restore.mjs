// Synthetic offline probe only. Mount a NEW disposable /data volume, never a real profile.
import assert from "node:assert/strict";
import {
  createNativeProfileRuntime,
  initializeNativeProfile,
} from "/app/ftrade-native-profile.mjs";
import { launchOptions } from "/app/node_modules/camoufox-js/dist/index.js";
import { firefox } from "/app/node_modules/playwright-core/index.mjs";

const mode = process.argv[2];
assert.ok(mode === "write" || mode === "read");
const accountId = "00000000-0000-4000-8000-000000000001";
const nodeId = "00000000-0000-4000-8000-000000000002";
const deadline = setTimeout(() => process.exit(124), 90000);
if (mode === "write") await initializeNativeProfile({ accountId, nodeId, source: "empty" });
const runtime = createNativeProfileRuntime({
  firefox,
  environment: {
    FTRADE_NATIVE_PROFILE: "1",
    FTRADE_PROFILE_ACCOUNT_ID: accountId,
    FTRADE_PROFILE_NODE_ID: nodeId,
  },
  leaseDeadline: async () => Date.now() + 30000,
});
const options = await launchOptions({
  executable_path: "/root/.cache/camoufox/camoufox-bin",
  headless: true,
  geoip: false,
  os: "linux",
  exclude_addons: ["UBO"],
});
const browser = await runtime.launch({ ...options, timeout: 45000 });
try {
  assert.throws(() => runtime.assertAccount(nodeId), /native_profile_account_mismatch/);
  const context = await runtime.contextFor(accountId);
  await context.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Synthetic offline migration probe</title>",
    }),
  );
  const page = await context.newPage();
  await page.goto("https://migration.invalid/");
  const result = await page.evaluate(async (mode) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("migration-synthetic", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keys");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    if (mode === "write") {
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode("synthetic-persistent-key"),
      );
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("keys", "readwrite");
        transaction.objectStore("keys").put({ key, iv, ciphertext }, "probe");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      localStorage.setItem("migration-probe", "persisted");
      // biome-ignore lint/suspicious/noDocumentCookie: Exercise Firefox native cookie persistence.
      document.cookie = "migration_probe=persisted; Max-Age=3600; Secure; Path=/";
    }
    const record = await new Promise((resolve, reject) => {
      const request = db.transaction("keys").objectStore("keys").get("probe");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv },
      record.key,
      record.ciphertext,
    );
    db.close();
    return {
      cookie: document.cookie.includes("migration_probe=persisted"),
      storage: localStorage.getItem("migration-probe"),
      nonExtractable: record.key.extractable === false,
      crypto: new TextDecoder().decode(plaintext),
    };
  }, mode);
  assert.deepEqual(result, {
    cookie: true,
    storage: "persisted",
    nonExtractable: true,
    crypto: "synthetic-persistent-key",
  });
  console.log(
    JSON.stringify({
      passed: true,
      mode,
      nativeProfile: true,
      nonExtractableWebCrypto: true,
      crossAccountRejected: true,
    }),
  );
} finally {
  await browser.close();
  clearTimeout(deadline);
}
