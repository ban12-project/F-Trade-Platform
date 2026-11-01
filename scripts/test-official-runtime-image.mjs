import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { containerSpec } from "../ops/browser-node/docker.mjs";

const image = process.env.OFFICIAL_RUNTIME_IMAGE;
assert.ok(image, "OFFICIAL_RUNTIME_IMAGE is required");
const engine = process.env.OFFICIAL_CONTAINER_ENGINE ?? "docker";
assert.ok(["docker", "podman"].includes(engine));
const prefix = engine === "podman" ? ["--connection", "podman-machine-default-root"] : [];
const call = (args, options = {}) =>
  execFileSync(engine, [...prefix, ...args], {
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
const name = `ftrade-official-fixture-${randomUUID()}`;
const volume = `${name}-data`;
const nodeId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const fixture = resolve("scripts/fixtures/official-runtime");
let source = resolve("ops/browser-node");
let agentSource, agentContainer;
let containerExists = false,
  volumeExists = false;
function runArgs(mode, detached = false, afterShutdown = false) {
  const spec = containerSpec(
    nodeId,
    {
      id: runId,
      accountId,
      kind: "interactive",
      ...(mode === "write" && process.env.OFFICIAL_TEST_FIRST_USE === "1"
        ? { initializeNativeProfile: true }
        : {}),
      memoryMb: 2048,
      proxy: { host: "proxy.invalid", port: 1234, username: "synthetic", password: "synthetic" },
    },
    image,
    Date.now() + 90000,
    true,
  );
  const host = spec.body.HostConfig;
  assert.equal(host.ReadonlyRootfs, true);
  assert.deepEqual(host.CapDrop, ["ALL"]);
  const args = [
    "run",
    ...(detached ? ["-d"] : []),
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--init",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--memory",
    String(host.Memory),
    "--memory-swap",
    String(host.MemorySwap),
    "--cpus",
    String(host.NanoCpus / 1e9),
    "--pids-limit",
    String(host.PidsLimit),
    "--shm-size",
    String(host.ShmSize),
  ];
  if (process.env.OFFICIAL_TEST_SECCOMP)
    args.push("--security-opt", `seccomp=${realpathSync(process.env.OFFICIAL_TEST_SECCOMP)}`);
  // Read the real runtime's temp mounts rather than maintaining a drifting copy.
  for (const [path, settings] of Object.entries(host.Tmpfs))
    args.push("--tmpfs", `${path}:${settings}`);
  args.push(
    "-v",
    `${volume}:/data`,
    "-v",
    `${fixture}:/fixture:ro`,
    "-v",
    `${source}:/project/browser-node:ro`,
    "-v",
    `${resolve("scripts/fixtures")}:/project-fixtures:ro`,
  );
  for (const env of spec.body.Env) args.push("-e", env);
  args.push("-e", `FIXTURE_MODE=${mode}`);
  if (afterShutdown) args.push("-e", "EXPECT_SHUTDOWN=1");
  if (mode === "lease") args.push("-v", `${fixture}/watchdog-entry.mjs:/app/server.js:ro`);
  args.push(
    "--entrypoint",
    "node",
    image,
    mode === "lease" ? "/opt/ftrade/watchdog.mjs" : "/fixture/acceptance.mjs",
  );
  return args;
}
try {
  const version = call([
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "/root/.cache/camoufox/browsers/official/158.0.1-beta.41/camoufox-bin",
    image,
    "--version",
  ]).trim();
  assert.match(version, /158\.0\.1-beta\.41/);
  console.log(JSON.stringify({ actualBrowserVersion: version }));
  if (process.env.OFFICIAL_RUNTIME_AGENT_IMAGE) {
    agentSource = mkdtempSync(resolve(tmpdir(), "official-agent-"));
    agentContainer = call(["create", process.env.OFFICIAL_RUNTIME_AGENT_IMAGE]).trim();
    call(["cp", `${agentContainer}:/app/ops/browser-node`, agentSource]);
    call(["rm", agentContainer]);
    agentContainer = undefined;
    source = resolve(agentSource, "browser-node");
  }
  call(["volume", "create", volume]);
  volumeExists = true;
  for (const mode of ["codec", "write", "read"]) {
    containerExists = true;
    console.log(call(runArgs(mode)));
    const state = JSON.parse(call(["inspect", "--format", "{{json .State}}", name]));
    assert.equal(state.OOMKilled, false);
    assert.equal(state.ExitCode, 0);
    call(["rm", name]);
    containerExists = false;
  }
  containerExists = true;
  call(runArgs("lease", true));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      call(["exec", name, "test", "-f", "/tmp/official-fixture-ready"], { stdio: "ignore" });
      ready = true;
      break;
    } catch {}
    assert.equal(call(["inspect", "--format", "{{.State.Running}}", name]).trim(), "true");
    await sleep(1000);
  }
  assert.ok(ready, "watchdog fixture not ready");
  call([
    "exec",
    name,
    "node",
    "-e",
    'require("fs").writeFileSync("/tmp/ftrade-lease",String(Date.now()+1000))',
  ]);
  const code = call(["wait", name], { timeout: 25000 }).trim();
  if (code !== "0") {
    const diagnostic = mkdtempSync(resolve(tmpdir(), "official-shutdown-"));
    try {
      call(["cp", `${name}:/data/synthetic-shutdown.json`, `${diagnostic}/stage.json`]);
      console.error(readFileSync(`${diagnostic}/stage.json`, "utf8"));
    } finally {
      rmSync(diagnostic, { recursive: true, force: true });
    }
  }
  assert.equal(code, "0", "watchdog shutdown did not flush the native context");
  call(["rm", name]);
  containerExists = false;
  containerExists = true;
  console.log(call(runArgs("read", false, true)));
  call(["rm", name]);
  containerExists = false;
  console.log(
    "PASS actual image: native profile restart, nonextractable key, API scope, noVNC keyboard, ticket replay, tunnel expiry and outer watchdog shutdown",
  );
} finally {
  if (containerExists) {
    try {
      console.error(call(["logs", "--tail", "80", name]));
    } catch {}
    try {
      call(["stop", "-t", "5", name]);
    } catch {}
    try {
      call(["rm", name]);
    } catch {}
  }
  if (volumeExists) call(["volume", "rm", volume]);
  if (agentContainer) call(["rm", agentContainer]);
  if (agentSource) rmSync(agentSource, { recursive: true, force: true });
}
