import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Sandbox } from "@vercel/sandbox";
import { startBrowserSandboxRuntime } from "../lib/browser-fleet/sandbox-runtime";
import { stopIdleBrowserSandboxSession } from "../lib/browser-fleet/sandbox-session";
import { createAccessKey } from "../lib/browser-fleet/security";

// Opt-in live test. Empty synthetic broker; never a real account or task.
const nodeId = randomUUID(),
  operationId = randomUUID();
const key = createAccessKey(nodeId);
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const payload = execFileSync(
  "git",
  ["archive", "--format=tar", revision, "ops/browser-node", "lib/browser-fleet"],
  { maxBuffer: 20_000_000 },
);
const output = "tmp/browser-sandbox-start";
await mkdir(output, { recursive: true, mode: 0o700 });
let sandbox: Sandbox | undefined;
async function run(stage: string, script: string, timeoutMs = 60000, args: string[] = []) {
  assert.ok(sandbox);
  const result = await sandbox.currentSession().runCommand({
    cmd: "bash",
    args: ["-euc", script, "ftrade-start-test", ...args],
    sudo: true,
    timeoutMs,
  });
  const stdout = await result.stdout(),
    stderr = await result.stderr();
  assert.ok(!stdout.includes(key) && !stderr.includes(key), "runtime leaked synthetic key");
  await writeFile(`${output}/${stage}.log`, `${stdout}\n${stderr}`, { mode: 0o600 });
  assert.equal(result.exitCode, 0, `${stage} failed; see ignored local log`);
  console.log(`PASS ${stage}`);
  return stdout;
}
try {
  sandbox = await Sandbox.create({
    persistent: false,
    ports: [9400, 9401],
    resources: { vcpus: 2 },
    timeout: 600000,
  });
  await writeFile(`${output}/sandbox-name`, sandbox.name, { mode: 0o600 });
  console.log("Created bounded synthetic startup Sandbox");
  await sandbox.currentSession().writeFiles([
    { path: "/tmp/ftrade-start-source.tar", content: payload, mode: 0o600 },
    { path: "/tmp/ftrade-node-key", content: key, mode: 0o600 },
    {
      path: "/tmp/ftrade-broker.mjs",
      mode: 0o600,
      content: `
import http from 'node:http';
import { readFileSync } from 'node:fs';
const key = readFileSync('/fixture/node-key', 'utf8').trim();
http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/browser-nodes' || req.headers.authorization !== 'Bearer ' + key) { res.writeHead(403).end(); return; }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks));
  console.log(body.operation);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body.operation === 'sync' ? {nodeId: process.argv[2], gatewayOrigin: process.argv[3], runs: []} : body.operation === 'recover' ? {active: true} : {run: null, serverNow: Date.now()}));
}).listen(9401, '127.0.0.1');
`,
    },
  ]);
  await run(
    "install",
    "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq docker.io docker-compose-v2; mkdir -p /vercel/sandbox/source /var/lib/ftrade-sandbox; chmod 700 /var/lib/ftrade-sandbox; tar -xf /tmp/ftrade-start-source.tar -C /vercel/sandbox/source; install -m 600 /tmp/ftrade-node-key /var/lib/ftrade-sandbox/node-key; install -m 600 /tmp/ftrade-broker.mjs /var/lib/ftrade-sandbox/broker.mjs; rm /tmp/ftrade-node-key",
    240000,
  );
  await run("cgroups", "bash /vercel/sandbox/source/ops/browser-node/prepare-sandbox-cgroups.sh");
  await sandbox.currentSession().runCommand({
    cmd: "sh",
    args: ["-c", "exec dockerd >/tmp/ftrade-dockerd.log 2>&1"],
    sudo: true,
    detached: true,
  });
  await run(
    "build",
    "for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done; cd /vercel/sandbox/source; docker build --label io.ftrade.lease-watchdog=1 -f ops/browser-node/Dockerfile -t ftrade-start-agent:test .",
    240000,
  );
  const image = (
    await run("image", "docker image inspect --format '{{.Id}}' ftrade-start-agent:test")
  ).trim();
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  await run(
    "broker",
    'docker run -d --name synthetic-broker --network host -v /var/lib/ftrade-sandbox:/fixture:ro "$1" node /fixture/broker.mjs "$2" "$3"',
    60000,
    [image, nodeId, sandbox.domain(9400)],
  );
  const runtimeSession = sandbox.currentSession();
  const runtimeInput = {
    nodeId,
    operationId,
    appOrigin: sandbox.domain(9401),
    agentImage: image,
    browserImage: image,
    accessKey: key,
  };
  const start = () =>
    startBrowserSandboxRuntime(runtimeSession, runtimeSession.sessionId, runtimeInput);
  assert.equal(await start(), "started");
  assert.equal(await start(), "already-running");
  console.log("PASS provider boundary startup and duplicate request");
  await run(
    "staging-cleanup",
    "test -z \"$(find /tmp -maxdepth 1 -name 'ftrade-runtime-*.key' -print)\"; test -z \"$(find /tmp -maxdepth 1 -name 'ftrade-runtime-*.env' -print)\"",
  );
  // Observe readiness without waking another session or waiting past its idle window.
  assert.equal(
    (
      await run("memory-limit", "docker exec ftrade-browser-agent cat /sys/fs/cgroup/memory.max")
    ).trim(),
    "536870912",
  );
  await run(
    "ready",
    "for i in $(seq 1 20); do docker logs ftrade-browser-agent 2>&1 | grep -q browser_node_ready && exit 0; sleep 1; done; docker logs ftrade-browser-agent; exit 1",
    25000,
  );
  const viewer = await fetch(`${sandbox.domain(9400)}/viewer`, {
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  assert.equal(viewer.status, 200);
  assert.match(await viewer.text(), /F-Trade browser/);
  console.log("PASS HTTPS viewer asset reached loopback gateway");
  await run(
    "idle",
    "timeout 50 docker wait ftrade-browser-agent; test \"$(docker inspect --format '{{.State.ExitCode}}' ftrade-browser-agent)\" = 0; docker logs ftrade-browser-agent | grep -q browser_node_idle_exit",
    55000,
  );
  assert.equal(await start(), "already-exited");
  console.log("PASS same operation does not restart the exited Agent");
  const brokerLog = await run("broker-operations", "docker logs synthetic-broker");
  assert.match(brokerLog, /^sync\nrecover\nclaim\n/);
  const session = sandbox.currentSession();
  assert.equal(await stopIdleBrowserSandboxSession(session, nodeId, session.sessionId), "stopped");
  const metadata = await Sandbox.get({ name: sandbox.name, resume: false });
  assert.equal(metadata.status, "stopped");
  assert.equal(metadata.currentSession().sessionId, session.sessionId);
  console.log("PASS whole VM retirement after actual Agent idle exit");
} finally {
  if (sandbox) {
    try {
      await sandbox.stop();
    } finally {
      await sandbox.delete({ deleteOrphanSnapshots: true });
    }
    console.log("Deleted synthetic startup Sandbox and snapshots");
  }
}
await writeFile(
  `${output}/result.json`,
  JSON.stringify({ revision, passed: true, cleanedUp: true }),
  { mode: 0o600 },
);
