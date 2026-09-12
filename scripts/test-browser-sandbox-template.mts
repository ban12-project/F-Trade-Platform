import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import {
  inspectBrowserSandbox,
  provisionBrowserSandbox,
} from "../lib/browser-fleet/sandbox-provider";

// Explicit live smoke; only synthetic volume data, no account or proxy credentials.
const template = z
  .object({
    snapshotId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    agentImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    browserImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    builderDeleted: z.literal(true),
  })
  .parse(JSON.parse(await readFile(process.argv[2], "utf8")));
const nodeId = randomUUID();
const output = `tmp/browser-sandbox-template-test-${nodeId}`;
await mkdir(output, { recursive: true, mode: 0o700 });
const name = `ftrade-browser-${nodeId}`;
await writeFile(`${output}/sandbox-name`, name, { mode: 0o600 });
console.log(`Template verification evidence: ${output}`);
let session: ReturnType<Sandbox["currentSession"]> | undefined;
let provisionAttempted = false;
async function run(stage: string, script: string, timeoutMs = 60000) {
  assert.ok(session);
  const result = await session.runCommand({
    cmd: "bash",
    args: ["-euc", script],
    sudo: true,
    timeoutMs,
  });
  await writeFile(`${output}/${stage}.log`, `${await result.stdout()}\n${await result.stderr()}`, {
    mode: 0o600,
  });
  assert.equal(result.exitCode, 0, `${stage} failed; see ignored log`);
  console.log(`PASS ${stage}`);
}
async function docker() {
  await run("cgroups", "bash /vercel/sandbox/source/ops/browser-node/prepare-sandbox-cgroups.sh");
  assert.ok(session);
  await session.runCommand({
    cmd: "sh",
    args: ["-c", "exec dockerd >/tmp/ftrade-dockerd.log 2>&1"],
    sudo: true,
    detached: true,
  });
  await run(
    "docker-ready",
    "for i in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
  );
}
async function browserProfile(mode: "write" | "read") {
  assert.ok(session);
  await session.writeFiles([
    {
      path: "/tmp/ftrade-profile-fixture.mjs",
      content: await readFile("scripts/browser-sandbox-profile-fixture.mjs"),
    },
  ]);
  await run(
    `browser-profile-${mode}`,
    `
    docker run -d --name ftrade-profile-proof --read-only --shm-size=256m
      --tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777
      -v ftrade-browser-profile-proof:/data
      -v /tmp/ftrade-profile-fixture.mjs:/fixture.mjs:ro
      -e FTRADE_LEASE_DEADLINE=$(( $(date +%s) * 1000 + 90000 ))
      -e CAMOFOX_PROFILE_DIR=/data/profiles -e CAMOFOX_CRASH_REPORT_ENABLED=false
      -e CAMOFOX_DISABLE_DEFAULT_ADDONS=true
      ${template.browserImage} >/dev/null
    docker exec ftrade-profile-proof node /fixture.mjs ${mode}
    docker stop -t 20 ftrade-profile-proof >/dev/null
    docker rm ftrade-profile-proof >/dev/null
  `.replace(/\n {6}/g, " "),
    150000,
  );
}
async function freeze() {
  await run(
    "freeze",
    'pid=$(cat /var/run/docker.pid); kill -TERM "$pid"; for i in $(seq 1 30); do ! kill -0 "$pid" 2>/dev/null && exit 0; sleep 1; done; exit 1',
  );
}
try {
  provisionAttempted = true;
  const created = await provisionBrowserSandbox({
    mode: "create",
    nodeId,
    operationId: randomUUID(),
    templateSnapshotId: template.snapshotId,
  });
  session = created.session;
  const firstSession = session.sessionId;
  assert.match(created.gatewayOrigin, /^https:\/\//);
  await docker();
  await run(
    "images",
    `docker image inspect ${template.agentImage} ${template.browserImage} >/dev/null; test -z "$(docker volume ls -q)"; test ! -e /var/lib/ftrade-sandbox/node-key`,
  );
  await run(
    "image-smoke",
    `cd /vercel/sandbox/source; IMAGE_PREFIX=ftrade-sandbox BUILD_TAG=test ARCH=amd64 REVISION=${template.revision} bash scripts/test-browser-images.sh`,
    120000,
  );
  await browserProfile("write");
  await run(
    "write-synthetic-volume",
    `docker volume create ftrade-template-proof >/dev/null; docker run --rm --network none -v ftrade-template-proof:/proof --entrypoint sh ${template.agentImage} -ec 'printf SYNTHETIC_TEMPLATE_RESTORE > /proof/marker'`,
  );
  await freeze();
  await session.stop();
  const stopped = await inspectBrowserSandbox(nodeId);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.timeout, 1200000);
  assert.equal(stopped.currentSession().sessionId, firstSession);
  const resumed = await provisionBrowserSandbox({
    mode: "resume",
    nodeId,
    operationId: randomUUID(),
  });
  session = resumed.session;
  assert.notEqual(session.sessionId, firstSession);
  await docker();
  await run(
    "restored-synthetic-volume",
    `test "$(docker run --rm --network none -v ftrade-template-proof:/proof --entrypoint cat ${template.agentImage} /proof/marker)" = SYNTHETIC_TEMPLATE_RESTORE; docker image inspect ${template.browserImage} >/dev/null`,
  );
  await browserProfile("read");
  await freeze();
} finally {
  if (provisionAttempted) {
    // Unique test-only name recorded before provider I/O. No runtime commands or
    // resume in cleanup, including when creation returned an ambiguous response.
    const cleanup = await Sandbox.get({ name, resume: false });
    try {
      await cleanup.currentSession().stop();
    } finally {
      await cleanup.delete({ deleteOrphanSnapshots: true });
    }
    console.log("Test VM and orphan test snapshots deleted");
  }
}
await writeFile(
  `${output}/result.json`,
  JSON.stringify(
    {
      templateSnapshotId: template.snapshotId,
      passed: true,
      syntheticVolumeRestored: true,
      actualBrowserProfileVerified: true,
      profileScope: "synthetic cookie and localStorage only; no IndexedDB or real login",
      cleanedUp: true,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
