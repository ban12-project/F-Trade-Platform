import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Sandbox } from "@vercel/sandbox";

// Deliberately opt-in: live provider calls, no account credentials or Facebook access.
const output = resolve("tmp/browser-sandbox-runtime");
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
async function run(stage: string, script: string, timeoutMs: number) {
  assert.ok(sandbox);
  console.log(`Starting ${stage}`);
  const result = await sandbox.runCommand({
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
}
try {
  sandbox = await Sandbox.create({
    name: `ftrade-runtime-test-${randomUUID()}`,
    persistent: true,
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
  await sandbox.writeFiles([
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
  await sandbox.runCommand({
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
  await run(
    "persist-marker",
    "docker volume create ftrade-synthetic-profile; docker run --rm --network none -v ftrade-synthetic-profile:/data --entrypoint sh ftrade-sandbox-browser-node:test-amd64 -ec 'printf SYNTHETIC_PROFILE > /data/marker'; kill -TERM $(cat /var/run/docker.pid); for i in $(seq 1 30); do ! kill -0 $(cat /var/run/docker.pid 2>/dev/null || echo 0) 2>/dev/null && exit 0; test ! -f /var/run/docker.pid && exit 0; sleep 1; done; exit 1",
    40_000,
  );
  const name = sandbox.name;
  await sandbox.stop();
  console.log("Snapshot stopped; resuming same Sandbox");
  sandbox = await Sandbox.get({ name, resume: true });
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "exec dockerd >/tmp/ftrade-dockerd.log 2>&1"],
    sudo: true,
    detached: true,
  });
  await run(
    "resume-docker",
    "for i in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
    40_000,
  );
  await run(
    "restore-profile",
    'test "$(docker run --rm --network none -v ftrade-synthetic-profile:/data --entrypoint cat ftrade-sandbox-browser-node:test-amd64 /data/marker)" = SYNTHETIC_PROFILE',
    30_000,
  );
} finally {
  if (sandbox) {
    try {
      await sandbox.stop();
    } finally {
      await sandbox.delete({ deleteOrphanSnapshots: true });
    }
    console.log("Sandbox stopped and deleted with its test snapshots");
  }
}

await writeFile(
  resolve(output, "result.json"),
  JSON.stringify(
    {
      revision,
      upstream: pin,
      docker: true,
      imageSmoke: true,
      syntheticVolumeRestored: true,
      liveAccount: false,
      cleanupCompleted: true,
    },
    null,
    2,
  ),
);
