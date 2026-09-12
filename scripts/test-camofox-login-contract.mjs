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
  "FTRADE_RUN_ID",
  "FTRADE_RUN_KIND",
];
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
try {
  cpSync("ops/browser-node/login-plugin", join(stage, "plugins/ftrade-login"), { recursive: true });
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
  const invoke = async (authorization) => {
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
      path: "/ftrade/login-fill",
      method: "POST",
      headers: { authorization },
      body: {},
    };
    const handlers = [accessKeyMiddleware(config), ...routes.get("post /ftrade/login-fill")];
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
  assert.equal(
    logs.some(([level]) => level === "error"),
    false,
    "Actual upstream loader must not swallow a registration error",
  );
  console.log(
    "PASS pinned Camofox loader + global/per-route auth: default off, registered routes, missing/wrong key denied, valid key reaches fail-closed fill",
  );
} finally {
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  rmSync(stage, { recursive: true, force: true });
}
