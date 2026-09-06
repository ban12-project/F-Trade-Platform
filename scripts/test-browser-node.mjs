import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { containerSpec, stopContainer } from "../ops/browser-node/docker.mjs";
import { safeAssetPath, createGateway } from "../ops/browser-node/gateway.mjs";
const nodeId = randomUUID(); const accountId = randomUUID();
const run = { id: randomUUID(), accountId, memoryMb: 2048, proxy: { host: "proxy.example", port: 3128, username: "u", password: "synthetic" } };
test("each account gets a stable distinct volume; runs get fresh containers", () => {
  const a = containerSpec(nodeId, run, "sha256:reviewed", Date.now() + 60_000);
  const b = containerSpec(nodeId, { ...run, id: randomUUID() }, "sha256:reviewed", Date.now() + 60_000);
  const c = containerSpec(nodeId, { ...run, accountId: randomUUID() }, "sha256:reviewed", Date.now() + 60_000);
  assert.equal(a.volume, b.volume); assert.notEqual(a.name, b.name); assert.notEqual(a.volume, c.volume);
  assert.notEqual(a.accessKey, b.accessKey); assert.notEqual(a.vncPassword, b.vncPassword);
});
test("browser runtime cannot access the host Docker socket or choose a mount", () => {
  const { body } = containerSpec(nodeId, run, "sha256:reviewed", Date.now() + 60_000);
  assert.equal(body.HostConfig.Privileged, undefined); assert.deepEqual(body.HostConfig.CapDrop, ["ALL"]);
  assert.equal(body.HostConfig.Mounts.length, 1); assert.equal(body.HostConfig.Mounts[0].Type, "volume");
  assert.equal(body.HostConfig.RestartPolicy.Name, "no");
  assert.equal(body.HostConfig.Memory, 2048 * 1024 * 1024);
  assert.equal(JSON.stringify(body).includes("docker.sock"), false);
});
test("all browser ports are loopback only", () => {
  const { body } = containerSpec(nodeId, run, "image", 1234);
  for (const mappings of Object.values(body.HostConfig.PortBindings)) for (const mapping of mappings) assert.equal(mapping.HostIp, "127.0.0.1");
});
test("missing or malformed proxy fails rather than falling back to direct egress", () => {
  for (const proxy of [null, { ...run.proxy, host: "http://evil/" }, { ...run.proxy, port: 0 }, { ...run.proxy, password: "x\0y" }]) assert.throws(() => containerSpec(nodeId, { ...run, proxy }, "image", 1234));
});
test("remote payload cannot inject resource names or giant memory allocations", () => {
  assert.throws(() => containerSpec("/../../etc", run, "image", 1234));
  assert.throws(() => containerSpec(nodeId, { ...run, memoryMb: 1e9 }, "image", 1234));
});
test("stopping verifies engine state and never deletes profile volumes", async () => {
  const calls = []; let running = true;
  await stopContainer(async (method, path) => { calls.push([method, path]); if (method === "POST") running = false; return { State: { Running: running } }; }, "runtime-id");
  assert.ok(calls.some(([method, path]) => method === "DELETE" && path.endsWith("?v=false")));
  assert.equal(calls.some(([, path]) => path.includes("/volumes/")), false);
});
test("unconfirmed stop never releases/removes the container", async () => {
  const calls = [];
  await assert.rejects(stopContainer(async (method, path) => { calls.push([method, path]); return { State: { Running: true } }; }, "runtime-id"));
  assert.equal(calls.some(([method]) => method === "DELETE"), false);
});
test("viewer assets reject traversal and non-static endpoints", () => {
  assert.equal(safeAssetPath("/core/rfb.js"), "/core/rfb.js");
  for (const path of ["/core/../../etc/passwd.js", "/core/%2e%2e/secrets.js", "/sessions/foo/storage_state", "/websockify", "/core/x.js?token=a", "/core/%xx.js"]) assert.throws(() => safeAssetPath(path));
});
test("iframe has exact frame-ancestor policy and unauthorized admission fails", async () => {
  const gateway = createGateway({ appOrigin: "https://app.example", nodeCall: async () => { throw new Error("denied"); }, slots: new Map(), port: 0 });
  await once(gateway.server, "listening"); const port = gateway.server.address().port;
  try {
    const page = await fetch(`http://127.0.0.1:${port}/viewer`);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors https:\/\/app.example/);
    assert.equal(page.headers.get("cache-control"), "no-store"); assert.equal(page.headers.get("referrer-policy"), "no-referrer"); await page.text();
    const denied = await fetch(`http://127.0.0.1:${port}/admit`, { method: "POST", headers: { Origin: "https://evil.example" }, body: JSON.stringify({ ticket: "bad" }) });
    assert.equal(denied.status, 403); await denied.text();
  } finally { gateway.close(); gateway.server.closeAllConnections(); }
});
