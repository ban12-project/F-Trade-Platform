import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeNativeProfile } from "../ops/browser-node/native-profile.mjs";
import { createOfficialLauncher } from "../ops/browser-node/official-runtime/launcher.mjs";

const accountId = "11111111-1111-4111-8111-111111111111";
const nodeId = "22222222-2222-4222-8222-222222222222";
const environment = {
  FTRADE_NATIVE_PROFILE: "1",
  FTRADE_PROFILE_ACCOUNT_ID: accountId,
  FTRADE_PROFILE_NODE_ID: nodeId,
  ENABLE_VNC: "1",
  VNC_RESOLUTION: "1440x900",
};

async function fixture(t, official, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), "official-launcher-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeNativeProfile({ root, accountId, nodeId, source: "empty" });
  return createOfficialLauncher({
    environment,
    root,
    leaseDeadline: async () => Date.now() + 30000,
    proxy: { server: "http://proxy.invalid:1234", username: "synthetic", password: "synthetic" },
    display: ":99",
    executablePath: "/opt/camoufox/camoufox-bin",
    official,
    ...extra,
  });
}

test("uses official persistent launcher, fixed proxy and mandatory GeoIP", async (t) => {
  const calls = [];
  const browser = { isConnected: () => true };
  const context = { browser: () => browser };
  const runtime = await fixture(t, {
    launchOptions: async (options) => {
      calls.push(options);
      return { proxy: options.proxy, headless: false };
    },
    Camoufox: async (options) => {
      calls.push(options);
      return context;
    },
  });
  assert.equal(await runtime.ensureBrowser(5000), browser);
  assert.equal(calls[0].geoip, true);
  assert.equal(calls[0].proxy.server, "http://proxy.invalid:1234");
  assert.deepEqual(calls[0].window, [1400, 860]);
  assert.equal(calls[1].persistent_context, true);
  assert.match(calls[1].from_options.user_data_dir, /native-profile-v1\/firefox$/);
  assert.equal(await runtime.contextFor(accountId), context);
  await assert.rejects(runtime.contextFor(nodeId), /native_profile_account_mismatch/);
});

test("GeoIP failure is sanitized and never retried without it", async (t) => {
  let attempts = 0;
  const runtime = await fixture(t, {
    launchOptions: async () => {
      attempts++;
      throw new Error("synthetic proxy credential");
    },
    Camoufox: async () => assert.fail("must not launch"),
  });
  await assert.rejects(runtime.ensureBrowser(5000), {
    message: "official_runtime_launch_options_failed",
  });
  assert.equal(attempts, 1);
});

test("expired lease prevents generating launch options", async (t) => {
  const runtime = await fixture(
    t,
    {
      launchOptions: async () => assert.fail("must not generate options"),
      Camoufox: async () => assert.fail("must not launch"),
    },
    { leaseDeadline: async () => Date.now() - 1 },
  );
  await assert.rejects(runtime.ensureBrowser(5000), /native_profile_lease_expired/);
});
