import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { containerSpec } from "../ops/browser-node/docker.mjs";
import {
  createNativeProfileRuntime,
  initializeNativeProfile,
} from "../ops/browser-node/native-profile.mjs";
import { patchNativeProfileSource } from "../ops/browser-node/patch-native-profile.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "ftrade-native-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const accountId = randomUUID(),
    nodeId = randomUUID();
  let alive = true,
    launches = 0,
    imports = 0,
    deadline = Date.now() + 90000;
  const browser = { isConnected: () => alive };
  const context = {
    browser: () => browser,
    async close() {
      alive = false;
    },
    async setStorageState() {
      imports++;
    },
  };
  let lastOptions;
  const runtime = (environment = {}) =>
    createNativeProfileRuntime({
      root,
      environment: {
        FTRADE_NATIVE_PROFILE: "1",
        FTRADE_PROFILE_ACCOUNT_ID: accountId,
        FTRADE_PROFILE_NODE_ID: nodeId,
        ...environment,
      },
      leaseDeadline: () => deadline,
      firefox: {
        async launchPersistentContext(path, options) {
          launches++;
          alive = true;
          lastOptions = options;
          assert.equal(path, join(root, "native-profile-v1", "firefox"));
          return context;
        },
      },
    });
  return {
    root,
    accountId,
    nodeId,
    runtime,
    context,
    browser,
    initialize: (source) => initializeNativeProfile({ root, accountId, nodeId, source }),
    expire: () => {
      deadline = 0;
    },
    counts: () => ({ launches, imports }),
    options: () => lastOptions,
  };
}
test("startup refuses missing profile; explicit initialization cannot overwrite it", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.runtime().launch({}));
  assert.equal(f.counts().launches, 0);
  await f.initialize("empty");
  await assert.rejects(f.initialize("empty"));
  const options = {
    proxy: { server: "http://fixed.invalid:3128" },
    permissions: ["geolocation"],
    viewport: null,
  };
  const r = f.runtime();
  await r.launch(options);
  assert.equal(f.options(), options);
  assert.equal(await r.contextFor(f.accountId), f.context);
  await assert.rejects(r.contextFor(randomUUID()), /account_mismatch/);
  await f.context.close();
  await assert.rejects(r.contextFor(f.accountId), /context_unavailable/);
  await r.launch(options);
  assert.equal(await r.contextFor(f.accountId), f.context);
  assert.equal(f.counts().imports, 0);
});
test("profile ownership and live leases are mandatory", async (t) => {
  const f = await fixture(t);
  await f.initialize("empty");
  await assert.rejects(
    f.runtime({ FTRADE_PROFILE_NODE_ID: randomUUID() }).launch({}),
    /manifest_invalid/,
  );
  await assert.rejects(
    f.runtime({ FTRADE_PROFILE_ACCOUNT_ID: randomUUID() }).launch({}),
    /manifest_invalid/,
  );
  f.expire();
  await assert.rejects(f.runtime().launch({}), /lease_expired/);
  assert.equal(f.counts().launches, 0);
});
test("native profile and manifest symlinks cannot redirect storage", async (t) => {
  const f = await fixture(t);
  await f.initialize("empty");
  const profile = join(f.root, "native-profile-v1", "firefox");
  await rm(profile, { recursive: true });
  await symlink(f.root, profile);
  await assert.rejects(f.runtime().launch({}), /directory_invalid/);
  assert.equal(f.counts().launches, 0);
});
test("legacy import is explicit, preserves source and runs once across runtime instances", async (t) => {
  const f = await fixture(t);
  const hash = createHash("sha256").update(f.accountId).digest("hex").slice(0, 32);
  const path = join(f.root, "profiles", hash);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const source = JSON.stringify({ cookies: [], origins: [] });
  await writeFile(join(path, "storage-state.json"), source, { mode: 0o600 });
  await assert.rejects(f.initialize("empty"), /migration_required/);
  await f.initialize("legacy-json");
  await f.runtime().launch({});
  await f.context.close();
  await f.runtime().launch({});
  assert.equal(f.counts().imports, 1);
  assert.equal(await readFile(join(path, "storage-state.json"), "utf8"), source);
});
test("changed legacy source and unsupported IndexedDB cannot masquerade as restored state", async (t) => {
  const f = await fixture(t);
  const hash = createHash("sha256").update(f.accountId).digest("hex").slice(0, 32);
  const path = join(f.root, "profiles", hash);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const file = join(path, "storage-state.json");
  await writeFile(file, JSON.stringify({ cookies: [], origins: [{ indexedDB: [{}] }] }), {
    mode: 0o600,
  });
  await assert.rejects(f.initialize("legacy-json"), /indexeddb_unsupported/);
  await writeFile(file, JSON.stringify({ cookies: [], origins: [] }));
  await f.initialize("legacy-json");
  await writeFile(
    file,
    JSON.stringify({
      cookies: [],
      origins: [{ origin: "https://synthetic.invalid", localStorage: [] }],
    }),
  );
  await assert.rejects(f.runtime().launch({}), /source_changed/);
  assert.equal(f.counts().launches, 0);
});
test("opt-in binds every task to the existing account volume, not task payload paths", () => {
  const nodeId = randomUUID(),
    accountId = randomUUID();
  const run = {
    id: randomUUID(),
    accountId,
    memoryMb: 2048,
    proxy: { host: "proxy.invalid", port: 3128, username: "", password: "" },
    nativeProfilePath: "/arbitrary",
  };
  const a = containerSpec(nodeId, run, "reviewed", Date.now() + 90000, true);
  const b = containerSpec(
    nodeId,
    { ...run, id: randomUUID() },
    "reviewed",
    Date.now() + 90000,
    true,
  );
  assert.equal(a.volume, b.volume);
  assert.ok(a.body.Env.includes(`FTRADE_PROFILE_ACCOUNT_ID=${accountId}`));
  assert.ok(a.body.Env.includes(`FTRADE_PROFILE_NODE_ID=${nodeId}`));
  assert.ok(!JSON.stringify(a).includes("/arbitrary"));
  assert.ok(
    !containerSpec(nodeId, run, "reviewed", Date.now() + 90000).body.Env.includes(
      "FTRADE_NATIVE_PROFILE=1",
    ),
  );
  assert.equal(createNativeProfileRuntime({ environment: {} }), null);
  assert.throws(
    () => patchNativeProfileSource("server.js", "unreviewed upstream"),
    /upstream_changed/,
  );
});
