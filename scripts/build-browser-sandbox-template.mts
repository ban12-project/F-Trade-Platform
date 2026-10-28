import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

// Opt-in deployment artifact builder. Never run against an existing account VM.
// Optional argv[2]: reviewed image bundle from export-browser-image-pair.sh.
// Reuses exact archive content; records destination-local IDs after verification.
const image = z
  .object({
    id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    architecture: z.literal("amd64"),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .strict();
const bundleDirectory = process.argv[2] ? resolve(process.argv[2]) : undefined;
const bundle = bundleDirectory
  ? z
      .object({
        version: z.literal(1),
        revision: z.string().regex(/^[a-f0-9]{40}$/),
        architecture: z.literal("amd64"),
        images: z.object({ agent: image, browser: image }).strict(),
      })
      .strict()
      .parse(JSON.parse(await readFile(resolve(bundleDirectory, "manifest.json"), "utf8")))
  : undefined;
const expirationDays = z.coerce
  .number()
  .int()
  .min(1)
  .max(30)
  .parse(process.env.BROWSER_TEMPLATE_EXPIRATION_DAYS ?? "7");
let archiveSha256: string | undefined;
if (bundle && bundleDirectory) {
  assert.equal(bundle.images.agent.revision, bundle.revision);
  assert.equal(bundle.images.browser.revision, bundle.revision);
  const lines = (await readFile(resolve(bundleDirectory, "checksums.sha256"), "utf8"))
    .trim()
    .split("\n");
  assert.equal(lines.length, 2);
  const checksums = new Map(
    lines.map((line) => {
      const match = /^([a-f0-9]{64}) {2}(tested-images\.tar\.gz|manifest\.json)$/.exec(line);
      assert.ok(match, "unexpected bundle checksum entry");
      return [match[2], match[1]];
    }),
  );
  assert.equal(checksums.size, 2);
  for (const filename of ["manifest.json", "tested-images.tar.gz"]) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(resolve(bundleDirectory, filename)))
      hash.update(chunk);
    assert.equal(
      hash.digest("hex"),
      checksums.get(filename),
      `bundle checksum mismatch: ${filename}`,
    );
  }
  archiveSha256 = checksums.get("tested-images.tar.gz");
}
const output = resolve(`tmp/browser-sandbox-template-${randomUUID()}`);
await mkdir(output, { recursive: true, mode: 0o700 });
const upstream = resolve(process.env.CAMOFOX_SOURCE_DIR ?? "ops/browser-node/upstream");
const builderRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const revision = bundle?.revision ?? builderRevision;
const verifier = bundle
  ? execFileSync("git", ["show", `${builderRevision}:scripts/verify-browser-image-bundle.py`])
  : undefined;
const bundleIdentity =
  bundleDirectory && verifier
    ? execFileSync(
        "python3",
        [
          "-c",
          verifier.toString("utf8"),
          "archive",
          resolve(bundleDirectory, "tested-images.tar.gz"),
          resolve(bundleDirectory, "manifest.json"),
        ],
        { maxBuffer: 2_000_000 },
      )
    : undefined;
const pin = execFileSync("git", ["show", `${revision}:ops/browser-node/camofox.ref`], {
  encoding: "utf8",
}).trim();
assert.match(pin, /^[a-f0-9]{40}$/);
if (!bundle)
  assert.equal(
    execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    pin,
  );
const observationRunner = execFileSync(
  "git",
  ["ls-tree", "--name-only", revision, "scripts/test-browser-observation-images.sh"],
  { encoding: "utf8" },
).trim();
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
    ...(observationRunner ? [observationRunner] : []),
    "scripts/test-native-profile-runtime.sh",
    "scripts/fixtures",
  ],
  { maxBuffer: 20_000_000 },
);
const source = bundle
  ? undefined
  : execFileSync("git", ["-C", upstream, "archive", "--format=tar", pin], {
      maxBuffer: 40_000_000,
    });
let sandbox: Sandbox | undefined;
let retainedSnapshotId: string | undefined;
let images: { agent: string; browser: string } | undefined;
let imageIdentityMapping: unknown;
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
    // Local SDK uploads can take longer than the actual build. This temporary
    // builder limit is independent of the provider's 20-minute account limit.
    timeout: bundle ? 2_400_000 : 1_200_000,
  });
  await writeFile(resolve(output, "sandbox-name"), sandbox.name, { mode: 0o600 });
  await run(
    "install",
    "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq docker.io docker-compose-v2",
    240_000,
  );
  await sandbox
    .currentSession()
    .writeFiles([
      { path: "/tmp/ftrade-payload.tar", content: payload },
      ...(source ? [{ path: "/tmp/ftrade-upstream.tar", content: source }] : []),
    ]);
  await run(
    "unpack",
    `mkdir -p /vercel/sandbox/source/ops/browser-node/upstream; tar -xf /tmp/ftrade-payload.tar -C /vercel/sandbox/source${source ? "; tar -xf /tmp/ftrade-upstream.tar -C /vercel/sandbox/source/ops/browser-node/upstream" : ""}`,
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
  if (bundle && bundleDirectory) {
    await sandbox.currentSession().mkDir("/tmp/ftrade-image-chunks");
    assert.ok(verifier && bundleIdentity);
    await sandbox.currentSession().writeFiles([
      { path: "/tmp/ftrade-image-verifier.py", content: verifier },
      { path: "/tmp/ftrade-image-identity.json", content: bundleIdentity },
    ]);
    let index = 0;
    let pending: Promise<void>[] = [];
    async function flushUploads() {
      const results = await Promise.allSettled(pending);
      pending = [];
      assert.ok(
        results.every((result) => result.status === "fulfilled"),
        "image chunk upload failed",
      );
    }
    try {
      for await (const chunk of createReadStream(resolve(bundleDirectory, "tested-images.tar.gz"), {
        highWaterMark: 16 * 1024 * 1024,
      })) {
        const upload = sandbox.currentSession().writeFiles([
          {
            path: `/tmp/ftrade-image-chunks/${String(index++).padStart(6, "0")}`,
            content: chunk,
          },
        ]);
        void upload.catch(() => {});
        pending.push(upload);
        if (pending.length === 4) await flushUploads();
        if (index % 16 === 0) console.log(`Uploaded ${index} image chunks`);
      }
    } finally {
      if (pending.length) await flushUploads();
    }
    await run(
      "import-images",
      `
      cat /tmp/ftrade-image-chunks/* > /tmp/ftrade-images.tar.gz
      echo '${archiveSha256}  /tmp/ftrade-images.tar.gz' | sha256sum -c -
      docker image load -i /tmp/ftrade-images.tar.gz
      test "$(docker image ls --all --no-trunc --format '{{.ID}}' | sort -u | wc -l)" -eq 2
      python3 /tmp/ftrade-image-verifier.py destination /tmp/ftrade-image-identity.json > /tmp/ftrade-image-mapping.json
      rm -rf /tmp/ftrade-image-chunks /tmp/ftrade-images.tar.gz /tmp/ftrade-image-verifier.py /tmp/ftrade-image-identity.json
    `,
      240000,
    );
    imageIdentityMapping = JSON.parse(
      await run(
        "image-identity",
        "cat /tmp/ftrade-image-mapping.json; rm /tmp/ftrade-image-mapping.json",
        30000,
      ),
    );
  } else {
    await run(
      "build-agent",
      `cd /vercel/sandbox/source; docker build --label org.opencontainers.image.revision=${revision} -f ops/browser-node/Dockerfile -t ftrade-sandbox-browser-node:test-amd64 .`,
      180_000,
    );
    await run(
      "build-base",
      "cd /vercel/sandbox/source; docker build --build-arg CAMOUFOX_VERSION=158.0 --build-arg CAMOUFOX_RELEASE=beta.40 --build-arg TARGETARCH=amd64 -f ops/browser-node/upstream/Dockerfile.ci -t ftrade-camofox-base:158.0-beta.40 ops/browser-node/upstream",
      420_000,
    );
    await run(
      "build-browser",
      `cd /vercel/sandbox/source; docker build --label org.opencontainers.image.revision=${revision} -f ops/browser-node/browser.Dockerfile -t ftrade-sandbox-browser:test-amd64 ops/browser-node`,
      60_000,
    );
  }
  // Tests and the retained template never need public network access.
  await sandbox.updateNetworkPolicy("deny-all");
  await run(
    "image-smoke",
    `cd /vercel/sandbox/source; IMAGE_PREFIX=ftrade-sandbox BUILD_TAG=test ARCH=amd64 REVISION=${revision} bash scripts/test-browser-images.sh`,
    360_000,
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
  const snapshot = await sandbox.snapshot({ expiration: expirationDays * 86400000 });
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
      builderRevision,
      upstream: pin,
      snapshotId: retainedSnapshotId,
      expirationDays,
      imageSource: bundle ? "verified-bundle" : "source-build",
      archiveSha256,
      imageIdentityMapping,
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
