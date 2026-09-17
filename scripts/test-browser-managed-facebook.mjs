import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { managedFacebookEnvironment } from "../ops/browser-node/managed-facebook.mjs";

const nodeId = "00000000-0000-4000-8000-000000000001";
const manifest = { version: 1, nodeId, publish: false, inbox: false, login: false };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "ftrade-managed-facebook-"));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const write = (name, value) =>
    writeFile(join(directory, name), JSON.stringify(value), { mode: 0o600 });
  return { directory, write, load: () => managedFacebookEnvironment(directory, nodeId, {}) };
}
const profile = (inbox = false) => ({
  version: 1,
  channelRef: "synthetic-channel",
  accountRef: "synthetic-account",
  reviewRef: "evidence-synthetic-test",
  reviewedAt: new Date(Date.now() - 60000).toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  url: inbox ? "https://www.facebook.com/messages/" : "https://www.facebook.com/",
  identityHref: "https://www.facebook.com/synthetic-account",
  selectors: Object.fromEntries(
    (inbox
      ? [
          "identity",
          "inboxReady",
          "conversationLink",
          "emptyInbox",
          "threadReady",
          "threadIdentity",
          "message",
          "inbound",
          "outbound",
          "body",
          "time",
          "emptyThread",
          "challenge",
          "loading",
          "moreThreads",
          "moreMessages",
        ]
      : [
          "identity",
          "openComposer",
          "composer",
          "textbox",
          "submit",
          "fileInput",
          "attachmentName",
          "post",
          "postAuthor",
          "postText",
          "postLink",
        ]
    ).map((key) => [key, `[data-test="${key}"]`]),
  ),
  ...(inbox
    ? { attributes: { conversationId: "data-conversation-id", messageId: "data-message-id" } }
    : {}),
});
function bootAdapter(environment) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {pathToFileURL} from 'node:url';
    const adapter = await import(pathToFileURL(process.env.BROWSER_TASK_ADAPTER));
    console.log(JSON.stringify({capabilities: adapter.capabilities, publicationScopes: adapter.publicationScopes, inboxScopes: adapter.inboxScopes}));
  `,
    ],
    { encoding: "utf8", env: { PATH: process.env.PATH, ...environment }, timeout: 10000 },
  );
}
test("unconfigured and empty managed directories preserve interactive-only defaults", async (t) => {
  assert.deepEqual(await managedFacebookEnvironment(undefined, nodeId, {}), {});
  const f = await fixture(t);
  assert.deepEqual(await f.load(), {});
  await f.write("manifest.json", manifest);
  assert.deepEqual(await f.load(), {});
});
test("managed node boots the existing adapter with only explicitly enabled scopes", async (t) => {
  for (const inbox of [false, true]) {
    const f = await fixture(t);
    await f.write("manifest.json", { ...manifest, publish: !inbox, inbox });
    await f.write(inbox ? "inbox.json" : "publication.json", [profile(inbox)]);
    const environment = await f.load();
    const result = bootAdapter(environment);
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.deepEqual(actual.capabilities, [inbox ? "inbox" : "publish"]);
    assert.equal(
      actual[inbox ? "inboxScopes" : "publicationScopes"][0].accountRef,
      "synthetic-account",
    );
    assert.deepEqual(actual[inbox ? "publicationScopes" : "inboxScopes"], []);
    assert.equal(environment.FACEBOOK_LOGIN_PROFILES_FILE, undefined);
  }
});
test("login-only provisioning never enables a publication or inbox adapter", async (t) => {
  const f = await fixture(t);
  await f.write("manifest.json", { ...manifest, login: true });
  await f.write("login.json", [{ profile: "validated by existing login loader" }]);
  assert.deepEqual(await f.load(), {
    FACEBOOK_LOGIN_PROFILES_FILE: join(f.directory, "login.json"),
  });
});
test("wrong node, unknown manifest fields and invalid switches fail without private data in errors", async (t) => {
  const f = await fixture(t);
  for (const value of [
    null,
    [],
    { ...manifest, nodeId: "another-node" },
    { ...manifest, publish: "true" },
    { ...manifest, path: "PRIVATE_SENTINEL" },
    { ...manifest, version: 2 },
  ]) {
    await f.write("manifest.json", value);
    await assert.rejects(f.load(), { message: "managed_facebook_configuration_invalid" });
  }
  await writeFile(join(f.directory, "manifest.json"), "PRIVATE_SENTINEL-invalid-json");
  await assert.rejects(f.load(), { message: "managed_facebook_configuration_invalid" });
});
test("missing, oversized, symlinked, or permissive profile files cannot activate a capability", async (t) => {
  const f = await fixture(t);
  await f.write("manifest.json", { ...manifest, publish: true });
  await assert.rejects(f.load());
  for (const values of [[], Array(17).fill({}), [{ text: "x".repeat(64001) }]]) {
    await f.write("publication.json", values);
    await assert.rejects(f.load());
  }
  await f.write("publication.json", [profile()]);
  await chmod(join(f.directory, "publication.json"), 0o644);
  await assert.rejects(f.load());
  await rm(join(f.directory, "publication.json"));
  await f.write("target.json", [profile()]);
  await symlink(join(f.directory, "target.json"), join(f.directory, "publication.json"));
  await assert.rejects(f.load());
});
test("private directory and manifest permissions and configuration conflicts are enforced", async (t) => {
  const f = await fixture(t);
  await f.write("manifest.json", manifest);
  await chmod(f.directory, 0o755);
  await assert.rejects(f.load());
  await chmod(f.directory, 0o700);
  await chmod(join(f.directory, "manifest.json"), 0o644);
  await assert.rejects(f.load());
  await chmod(join(f.directory, "manifest.json"), 0o600);
  for (const key of [
    "BROWSER_TASK_ADAPTER",
    "FACEBOOK_DOM_PROFILES_FILE",
    "FACEBOOK_INBOX_PROFILES_FILE",
    "FACEBOOK_LOGIN_PROFILES_FILE",
  ])
    await assert.rejects(
      managedFacebookEnvironment(f.directory, nodeId, { [key]: "other-config" }),
    );
});
test("expired and malformed reviewed profiles still fail in the real adapter loader", async (t) => {
  const f = await fixture(t);
  await f.write("manifest.json", { ...manifest, publish: true });
  for (const value of [
    { ...profile(), expiresAt: new Date(0).toISOString() },
    { ...profile(), selectors: {} },
  ]) {
    await f.write("publication.json", [value]);
    const result = bootAdapter(await f.load());
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
  }
});
