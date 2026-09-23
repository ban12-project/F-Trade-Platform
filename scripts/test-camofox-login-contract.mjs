import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const upstream = resolve("ops/browser-node/upstream");
const pin = readFileSync("ops/browser-node/camofox.ref", "utf8").trim();
assert.equal(
  spawnSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  pin,
);
const { loadPlugins } = await import(pathToFileURL(join(upstream, "lib/plugins.js")));
const { requireAuth, accessKeyMiddleware } = await import(
  pathToFileURL(join(upstream, "lib/auth.js"))
);
const stage = mkdtempSync(join(tmpdir(), "ftrade-pinned-plugin-"));
const names = [
  "FTRADE_LOGIN_PROFILE_JSON",
  "FTRADE_ACCOUNT_ID",
  "FTRADE_ACCOUNT_REF",
  "FTRADE_RUN_ID",
  "FTRADE_RUN_KIND",
];
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
try {
  cpSync("ops/browser-node/login-plugin", join(stage, "plugins/ftrade-login"), { recursive: true });
  // Keep the actual plugin/loader paths but isolate the runtime lease file.
  const leaseFile = join(stage, "lease");
  const stagedPlugin = join(stage, "plugins/ftrade-login/index.js");
  writeFileSync(
    stagedPlugin,
    readFileSync(stagedPlugin, "utf8").replaceAll("/tmp/ftrade-lease", leaseFile),
  );
  writeFileSync(join(stage, "package.json"), '{"type":"module"}');
  cpSync("ops/browser-node/camofox.config.json", join(stage, "config.json"));
  const routes = new Map();
  const app = Object.fromEntries(
    ["get", "post"].map((method) => [
      method,
      (path, ...handlers) => routes.set(`${method} ${path}`, handlers),
    ]),
  );
  const config = { accessKey: "SYNTHETIC-container-key", nodeEnv: "production" };
  const logs = [];
  const ctx = {
    sessions: new Map(),
    config,
    auth: () => requireAuth(config),
    log: (...args) => logs.push(args),
  };
  const options = { pluginsDir: join(stage, "plugins"), configPath: join(stage, "config.json") };
  delete process.env.FTRADE_LOGIN_PROFILE_JSON;
  assert.deepEqual(await loadPlugins(app, ctx, options), ["ftrade-login"]);
  assert.equal(routes.size, 0, "No profile must expose no credential endpoint");
  process.env.FTRADE_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
  process.env.FTRADE_RUN_ID = "00000000-0000-4000-8000-000000000002";
  process.env.FTRADE_RUN_KIND = "interactive";
  process.env.FTRADE_LOGIN_PROFILE_JSON = JSON.stringify({
    version: 1,
    reviewRef: "evidence-synthetic-reviewed",
    reviewedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    url: "https://www.facebook.com/login/",
    form: "#synthetic-form",
    username: "#synthetic-user",
    password: "#synthetic-password",
  });
  assert.deepEqual(await loadPlugins(app, ctx, options), ["ftrade-login"]);
  assert.equal(routes.size, 2);
  const invoke = async (authorization, path = "/ftrade/login-fill", method = "POST") => {
    let status = 200,
      body;
    const res = {
      status(value) {
        status = value;
        return this;
      },
      set() {
        return this;
      },
      json(value) {
        body = value;
        return this;
      },
    };
    const req = {
      path,
      method,
      headers: { authorization },
      body: {},
    };
    const handlers = [
      accessKeyMiddleware(config),
      ...routes.get(`${method.toLowerCase()} ${path}`),
    ];
    const next = async () => {
      const handler = handlers.shift();
      if (handler) await handler(req, res, next);
    };
    await next();
    return { status, body };
  };
  assert.equal((await invoke(undefined)).status, 401);
  assert.equal((await invoke("Bearer SYNTHETIC-wrong-key")).status, 401);
  assert.deepEqual(await invoke(`Bearer ${config.accessKey}`), {
    status: 200,
    body: { outcome: "refused" },
  });
  const legacy = JSON.parse(process.env.FTRADE_LOGIN_PROFILE_JSON);
  process.env.FTRADE_ACCOUNT_REF = "123456789";
  process.env.FTRADE_LOGIN_PROFILE_JSON = JSON.stringify({
    ...legacy,
    version: 2,
    automation: {
      accountRef: "123456789",
      identity: { selector: "#identity", attribute: "data-account-id" },
      passwordSubmit: "#submit",
      totp: {
        url: "https://www.facebook.com/two_factor/",
        marker: "#totp",
        input: "#code",
        submit: "#verify",
      },
      pin: {
        url: "https://www.facebook.com/messages/",
        marker: "#pin",
        input: "#pin-code",
        submit: null,
      },
      ready: {
        url: "https://www.facebook.com/messages/",
        marker: "#chats",
        empty: "#empty",
        emptyText: "No chats",
        thread: "#thread",
      },
      checkpoint: "#checkpoint",
      rejected: "#rejected",
      loading: "#loading",
    },
  });
  routes.clear();
  assert.deepEqual(await loadPlugins(app, ctx, options), ["ftrade-login"]);
  assert.equal(routes.size, 3);
  assert.equal(routes.has("post /ftrade/login-fill"), false);
  for (const [method, path] of [
    ["GET", "/ftrade/login-status"],
    ["POST", "/ftrade/login-observe"],
    ["POST", "/ftrade/login-submit"],
  ]) {
    assert.equal((await invoke(undefined, path, method)).status, 401);
    assert.equal((await invoke("Bearer SYNTHETIC-wrong-key", path, method)).status, 401);
  }
  const status = () => invoke(`Bearer ${config.accessKey}`, "/ftrade/login-status", "GET");
  assert.deepEqual(await status(), { status: 403, body: { error: "login_unavailable" } });
  writeFileSync(leaseFile, String(Date.now() + 30000));
  const available = await status();
  assert.equal(available.status, 200);
  assert.equal(available.body.version, 2);
  assert.equal(available.body.accountId, process.env.FTRADE_ACCOUNT_ID);
  writeFileSync(leaseFile, "0");
  assert.deepEqual(await status(), { status: 403, body: { error: "login_unavailable" } });
  writeFileSync(leaseFile, "invalid");
  assert.deepEqual(await status(), { status: 403, body: { error: "login_unavailable" } });
  assert.equal(
    logs.some(([level]) => level === "error"),
    false,
    "Actual upstream loader must not swallow a registration error",
  );
  console.log(
    "PASS pinned Camofox loader + global/per-route auth: default off, registered routes, missing/wrong key denied, valid key reaches fail-closed fill; v2 routes authenticated and expired/missing leases denied",
  );
} finally {
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  rmSync(stage, { recursive: true, force: true });
}
