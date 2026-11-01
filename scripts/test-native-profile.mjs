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
  nativeProfileLaunchOptions,
  nativeProfileWindowSize,
} from "../ops/browser-node/native-profile.mjs";
import { createStartupDiagnostics } from "../ops/browser-node/startup-diagnostics.mjs";

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
  let failLaunch = false;
  const runtime = (environment = {}, startupDiagnostics) =>
    createNativeProfileRuntime({
      root,
      startupDiagnostics,
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
          if (failLaunch) throw new Error("synthetic Firefox launch failure");
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
    failLaunch: (value) => {
      failLaunch = value;
    },
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
test("broker-authorized first use initializes empty storage and later starts retain it", async (t) => {
  const f = await fixture(t);
  const r = f.runtime({ FTRADE_NATIVE_PROFILE_FIRST_USE: "1" });
  await r.launch({});
  const ownerPath = join(f.root, "native-profile-v1", "owner.json");
  const owner = await readFile(ownerPath, "utf8");
  assert.deepEqual(JSON.parse(owner), {
    version: 1,
    accountId: f.accountId,
    nodeId: f.nodeId,
    source: "empty",
    legacyDigest: null,
    imported: true,
  });
  const retained = join(f.root, "native-profile-v1", "firefox", "synthetic-history");
  await writeFile(retained, "retained");
  await f.context.close();
  await f.runtime().launch({});
  assert.equal(await readFile(retained, "utf8"), "retained");
  assert.equal(await readFile(ownerPath, "utf8"), owner);
  await f.context.close();
  await rm(join(f.root, "native-profile-v1"), { recursive: true });
  await assert.rejects(r.launch({}));
  await assert.rejects(f.runtime().launch({}));
});
test("failed first Firefox launch preserves initialized ownership for a bounded retry", async (t) => {
  const f = await fixture(t);
  f.failLaunch(true);
  await assert.rejects(
    f.runtime({ FTRADE_NATIVE_PROFILE_FIRST_USE: "1" }).launch({}),
    /native_profile_launch_failed/,
  );
  const ownerPath = join(f.root, "native-profile-v1", "owner.json");
  const owner = await readFile(ownerPath, "utf8");
  const retained = join(f.root, "native-profile-v1", "firefox", "synthetic-partial-launch");
  await writeFile(retained, "must not reset");
  f.failLaunch(false);
  await f.runtime({ FTRADE_NATIVE_PROFILE_FIRST_USE: "1" }).launch({});
  assert.equal(await readFile(ownerPath, "utf8"), owner);
  assert.equal(await readFile(retained, "utf8"), "must not reset");
  assert.equal(f.counts().launches, 2);
});
test("first-use authorization cannot overwrite nonempty or partial storage", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, "historical-marker"), "retain");
  await assert.rejects(f.runtime({ FTRADE_NATIVE_PROFILE_FIRST_USE: "1" }).launch({}));
  assert.equal(await readFile(join(f.root, "historical-marker"), "utf8"), "retain");
  assert.equal(f.counts().launches, 0);
  await mkdir(join(f.root, "native-profile-v1"), { mode: 0o700 });
  await assert.rejects(f.runtime({ FTRADE_NATIVE_PROFILE_FIRST_USE: "1" }).launch({}));
  assert.equal(f.counts().launches, 0);
});
test("first-use authorization still requires a live lease and matching existing owner", async (t) => {
  const f = await fixture(t);
  await f.initialize("empty");
  await assert.rejects(
    f
      .runtime({ FTRADE_NATIVE_PROFILE_FIRST_USE: "1", FTRADE_PROFILE_NODE_ID: randomUUID() })
      .launch({}),
    /manifest_invalid/,
  );
  const empty = await fixture(t);
  empty.expire();
  await assert.rejects(
    empty.runtime({ FTRADE_NATIVE_PROFILE_FIRST_USE: "1" }).launch({}),
    /lease_expired/,
  );
  await empty.initialize("empty"); // expired startup made no partial directory
});
test("concurrent initializers cannot replace each other's owner manifest", async (t) => {
  const f = await fixture(t);
  const outcomes = await Promise.allSettled([f.initialize("empty"), f.initialize("empty")]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  await f.runtime().launch({});
});
test("native startup reports profile validation separately from the Firefox launch", async (t) => {
  const f = await fixture(t);
  const diagnostics = createStartupDiagnostics();
  diagnostics.begin();
  await assert.rejects(f.runtime({}, diagnostics).launch({}));
  assert.equal(diagnostics.read().stage, "profile-check");
  assert.equal(f.counts().launches, 0);
  await f.initialize("empty");
  await f.runtime({}, diagnostics).launch({});
  assert.equal(diagnostics.read().stage, "firefox-launch");
  assert.equal(f.counts().launches, 1);
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
});

test("timed-out observation retains one in-flight native launch until it settles", async (t) => {
  const f = await fixture(t);
  const runtime = f.runtime();
  let complete;
  let attempts = 0;
  const factory = () => {
    attempts++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  await assert.rejects(runtime.ensureBrowser(factory, 10), /launch_timeout/);
  await assert.rejects(runtime.ensureBrowser(factory, 10), /launch_timeout/);
  assert.equal(attempts, 1);
  const next = runtime.ensureBrowser(factory, 1000);
  complete(f.browser);
  assert.equal(await next, f.browser);
  assert.equal(attempts, 1);
  assert.equal(
    await runtime.ensureBrowser(async () => {
      attempts++;
      return f.browser;
    }, 1000),
    f.browser,
  );
  assert.equal(attempts, 2);
});

test("headed native windows fit the configured desktop without changing proxy or profile state", async (t) => {
  const f = await fixture(t);
  await f.initialize("empty");
  const options = {
    viewport: null,
    proxy: { server: "http://fixed.invalid:3128" },
    args: ["-no-remote"],
  };
  await f.runtime({ ENABLE_VNC: "1", VNC_RESOLUTION: "1440x900" }).launch(options);
  assert.equal(f.options().viewport, null);
  assert.deepEqual(
    nativeProfileWindowSize({ ENABLE_VNC: "1", VNC_RESOLUTION: "1440x900" }),
    [1400, 860],
  );
  assert.equal(nativeProfileWindowSize({}), undefined);
  assert.equal(f.options().deviceScaleFactor, undefined);
  assert.equal(f.options().proxy, options.proxy);
  assert.equal(f.options().args, options.args);
  assert.equal(options.viewport, null);
  assert.equal(f.counts().imports, 0);
  assert.equal(nativeProfileLaunchOptions(options, {}), options);
  for (const resolution of ["640x480", "4000x900", "1440x900junk", "1440x9999", "1440;runx900"]) {
    assert.throws(
      () => nativeProfileLaunchOptions(options, { ENABLE_VNC: "1", VNC_RESOLUTION: resolution }),
      /display_invalid/,
    );
  }
});
