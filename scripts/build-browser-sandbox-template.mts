import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Sandbox } from "@vercel/sandbox";

// Opt-in deployment artifact builder. Never run against an existing account VM.
// Retains one seven-day template snapshot; always deletes the temporary builder.
const output = resolve(`tmp/browser-sandbox-template-${randomUUID()}`);
await mkdir(output, { recursive: true, mode: 0o700 });
const upstream = resolve(process.env.CAMOFOX_SOURCE_DIR ?? "ops/browser-node/upstream");
const pin = (await readFile("ops/browser-node/camofox.ref", "utf8")).trim();
assert.match(pin, /^[a-f0-9]{40}$/);
assert.equal(
  execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  pin,
);
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
// Only committed runtime files and the reviewed upstream commit leave the machine.
const payload = execFileSync(
  "git",
  [
    "archive",
    "--format=tar",
    revision,
    "ops/browser-node",
    "lib/browser-fleet",
    "scripts/test-browser-images.sh",
  ],
  { maxBuffer: 20_000_000 },
);
const source = execFileSync("git", ["-C", upstream, "archive", "--format=tar", pin], {
  maxBuffer: 40_000_000,
});
let sandbox: Sandbox | undefined;
let retainedSnapshotId: string | undefined;
let images: { agent: string; browser: string } | undefined;
console.log(`Template build evidence: ${output}`);
async function run(stage: string, script: string, timeoutMs: number) {
  assert.ok(sandbox);
  console.log(`Starting ${stage}`);
  const result = await sandbox.currentSession().runCommand({
    cmd: "bash",
    args: ["-euc", script],
    sudo: true,
    timeoutMs,
  });
  await writeFile(
    resolve(output, `${stage}.log`),
    `${await result.stdout()}\n${await result.stderr()}`,
    { mode: 0o600 },
  );
  assert.equal(result.exitCode, 0, `${stage} failed; see ignored local log`);
  console.log(`PASS ${stage}`);
  return (await result.stdout()).trim();
}
try {
  sandbox = await Sandbox.create({
    name: `ftrade-template-build-${randomUUID()}`,
    persistent: false,
    snapshotExpiration: 86_400_000,
    keepLastSnapshots: { count: 1, deleteEvicted: true },
    resources: { vcpus: 4 },
    timeout: 1_200_000,
  });
  await writeFile(resolve(output, "sandbox-name"), sandbox.name, { mode: 0o600 });
  await run(
    "install",
    "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq docker.io docker-compose-v2",
    240_000,
  );
  await sandbox.currentSession().writeFiles([
    { path: "/tmp/ftrade-payload.tar", content: payload },
    { path: "/tmp/ftrade-upstream.tar", content: source },
  ]);
  await run(
    "unpack",
    "mkdir -p /vercel/sandbox/source/ops/browser-node/upstream; tar -xf /tmp/ftrade-payload.tar -C /vercel/sandbox/source; tar -xf /tmp/ftrade-upstream.tar -C /vercel/sandbox/source/ops/browser-node/upstream",
    30_000,
  );
  await run(
    "cgroups",
    "bash /vercel/sandbox/source/ops/browser-node/prepare-sandbox-cgroups.sh",
    30000,
  );
  await sandbox.currentSession().runCommand({
    cmd: "sh",
    args: ["-c", "exec dockerd >/tmp/ftrade-dockerd.log 2>&1"],
    sudo: true,
    detached: true,
  });
  await run(
    "docker-ready",
    "for i in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
    40_000,
  );
  await run(
    "build-agent",
    `cd /vercel/sandbox/source; docker build --label org.opencontainers.image.revision=${revision} -f ops/browser-node/Dockerfile -t ftrade-sandbox-browser-node:test-amd64 .`,
    180_000,
  );
  await run(
    "build-base",
    "cd /vercel/sandbox/source; docker build --build-arg TARGETARCH=amd64 -f ops/browser-node/upstream/Dockerfile.ci -t ftrade-camofox-base:e5a36f5 ops/browser-node/upstream",
    420_000,
  );
  await run(
    "build-browser",
    `cd /vercel/sandbox/source; docker build --label org.opencontainers.image.revision=${revision} -f ops/browser-node/browser.Dockerfile -t ftrade-sandbox-browser:test-amd64 ops/browser-node`,
    60_000,
  );
  await run(
    "image-smoke",
    `cd /vercel/sandbox/source; IMAGE_PREFIX=ftrade-sandbox BUILD_TAG=test ARCH=amd64 REVISION=${revision} bash scripts/test-browser-images.sh`,
    120_000,
  );
  const imageOutput = await run(
    "template-check",
    `test ! -e /var/lib/ftrade-sandbox/node-key
     test ! -e /var/lib/ftrade-sandbox/runtime.env
     test -z "$(docker ps -aq)"
     test -z "$(docker volume ls -q)"
     docker image inspect --format '{{.Id}}' ftrade-sandbox-browser-node:test-amd64 ftrade-sandbox-browser:test-amd64`,
    30000,
  );
  const [agent, browser, extra] = imageOutput.split("\n");
  assert.match(agent, /^sha256:[a-f0-9]{64}$/);
  assert.match(browser, /^sha256:[a-f0-9]{64}$/);
  assert.equal(extra, undefined);
  images = { agent, browser };
  await run(
    "freeze-docker",
    `pid=$(cat /var/run/docker.pid)
     kill -TERM "$pid"
     for i in $(seq 1 30); do
       if ! kill -0 "$pid" 2>/dev/null; then exit 0; fi
       sleep 1
     done
     exit 1`,
    40000,
  );
  const snapshot = await sandbox.snapshot({ expiration: 7 * 86400000 });
  retainedSnapshotId = snapshot.snapshotId;
  // Persist the ID immediately, so an interrupted cleanup cannot lose track of
  // a retained artifact. Deployment must use result.json only after cleanup.
  await writeFile(resolve(output, "snapshot-id"), retainedSnapshotId, { mode: 0o600 });
} finally {
  if (sandbox) {
    try {
      await sandbox.currentSession().stop();
    } finally {
      await sandbox.delete({ deleteOrphanSnapshots: !retainedSnapshotId });
    }
    console.log("Temporary builder VM deleted");
  }
}
assert.ok(retainedSnapshotId && images);
await writeFile(
  resolve(output, "result.json"),
  JSON.stringify(
    {
      revision,
      upstream: pin,
      snapshotId: retainedSnapshotId,
      expirationDays: 7,
      agentImage: images.agent,
      browserImage: images.browser,
      imageSmoke: true,
      noAccountVolumes: true,
      builderDeleted: true,
      profileRestoreVerified: false,
      productionEnabled: false,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  "Template artifact ready for separate provisioning verification; production remains disabled",
);
