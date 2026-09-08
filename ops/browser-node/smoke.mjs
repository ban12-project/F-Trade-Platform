import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initialState } from "../../lib/browser-fleet/policy.ts";
import { accessKeyNodeId, createAccessKey } from "../../lib/browser-fleet/security.ts";
import { createFacebookDriver } from "./facebook-driver.mjs";
import { createFacebookInbox } from "./facebook-inbox.mjs";
import { createInboxReporter } from "./inbox.mjs";
import { register as registerLogin } from "./login-plugin/index.js";
import pagePrograms from "./page-programs.cjs";
import { createPublicationExecutor } from "./publication-executor.mjs";

for (const path of [
  "./docker.mjs",
  "./egress.mjs",
  "./gateway.mjs",
  "./lease.mjs",
  "./media.mjs",
  "./publication.mjs",
  "./upload.mjs",
]) {
  await import(path);
}
registerLogin(
  {
    post() {
      throw new Error("login_plugin_must_default_off");
    },
  },
  {},
  {},
);
if (process.argv[2]) assert.equal(process.arch, process.argv[2]);
assert.equal(Number(process.versions.node.split(".")[0]), 24);
assert.equal(
  initialState({ maxBrowsers: 1, memoryBudgetMb: 2048, browserMemoryMb: 2048 }).runs.length,
  0,
);
const id = randomUUID();
assert.equal(accessKeyNodeId(createAccessKey(id)), id);
for (const value of [
  createFacebookDriver,
  createFacebookInbox,
  createInboxReporter,
  createPublicationExecutor,
])
  assert.equal(typeof value, "function");
for (const source of Object.values(pagePrograms)) {
  assert.equal(typeof source, "string");
  assert.ok(source.length > 100);
  // Parse the page program without executing or providing browser/account data.
  assert.equal(typeof new Function(`return (${source});`)(), "function");
  assert.equal(source.includes("__name("), false);
}
const syntax = spawnSync(
  process.execPath,
  ["--check", new URL("./agent.mjs", import.meta.url).pathname],
  { encoding: "utf8" },
);
assert.equal(syntax.status, 0, "Agent entrypoint syntax must be valid in the image runtime");
// No profiles are supplied. The explicit adapter must fail for this exact reason,
// rather than loading successfully or failing because a packaged dependency is missing.
delete process.env.FACEBOOK_DOM_PROFILES_FILE;
delete process.env.FACEBOOK_INBOX_PROFILES_FILE;
await assert.rejects(import("./facebook-adapter.mjs"), /facebook_dom_profiles_required/);
console.log(
  "PASS offline Agent payload: native Node 24 imports, fixed page assets and explicit adapter configuration",
);
