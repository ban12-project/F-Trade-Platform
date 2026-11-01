import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Only newly created synthetic volumes. No option accepts a real profile path.
const previous = process.env.PREVIOUS_BROWSER_IMAGE;
const candidate = process.env.OFFICIAL_RUNTIME_IMAGE;
assert.ok(previous && candidate, "both immutable browser images are required");
const engine = process.env.OFFICIAL_CONTAINER_ENGINE ?? "docker";
assert.ok(["docker", "podman"].includes(engine));
const prefix = engine === "podman" ? ["--connection", "podman-machine-default-root"] : [];
const call = (args) =>
  execFileSync(engine, [...prefix, ...args], {
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 1024 * 1024,
  });
const oldImage = call(["image", "inspect", "--format", "{{.Id}}", previous]).trim();
const newImage = call(["image", "inspect", "--format", "{{.Id}}", candidate]).trim();
assert.notEqual(oldImage, newImage);
const name = `ftrade-upgrade-${randomUUID()}`;
const original = `${name}-original`,
  migrated = `${name}-candidate`;
const directory = mkdtempSync(resolve(tmpdir(), "ftrade-upgrade-"));
const fixture = readFileSync("scripts/fixtures/native-profile/vps-restore.mjs", "utf8");
writeFileSync(resolve(directory, "current.mjs"), fixture);
// This is a probe for the immutable PREVIOUS image, never a runtime dependency.
writeFileSync(
  resolve(directory, "previous.mjs"),
  fixture
    .replace(
      "/root/.cache/camoufox/browsers/official/158.0.1-beta.41/camoufox-bin",
      "/root/.cache/camoufox/camoufox-bin",
    )
    .replace(
      "/app/official-runtime/node_modules/camoufox/dist/index.js",
      "/app/node_modules/camoufox-js/dist/index.js",
    )
    .replace(
      "/app/official-runtime/node_modules/playwright-core/index.mjs",
      "/app/node_modules/playwright-core/index.mjs",
    ),
);
const volumes = [];
let container;
function run(image, volume, probe, mode) {
  container = `${name}-${probe}-${mode}`;
  const args = [
    "run",
    "--name",
    container,
    "--network",
    "none",
    "--read-only",
    "--init",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--memory",
    "2g",
    "--memory-swap",
    "2g",
    "--cpus",
    "2",
    "--pids-limit",
    "512",
    "--shm-size",
    "256m",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=512m,mode=1777",
    "--tmpfs",
    "/root/.camoufox:rw,nosuid,nodev,size=16m,mode=700",
    "--tmpfs",
    "/root/camoufox:rw,nosuid,nodev,size=16m,mode=700",
  ];
  if (process.env.OFFICIAL_TEST_SECCOMP)
    args.push("--security-opt", `seccomp=${realpathSync(process.env.OFFICIAL_TEST_SECCOMP)}`);
  args.push(
    "-v",
    `${volume}:/data`,
    "-v",
    `${directory}:/fixture:ro`,
    "--entrypoint",
    "node",
    image,
    `/fixture/${probe}.mjs`,
    mode,
  );
  console.log(call(args));
  const state = JSON.parse(call(["inspect", "--format", "{{json .State}}", container]));
  assert.equal(state.ExitCode, 0);
  assert.equal(state.OOMKilled, false);
  call(["rm", container]);
  container = undefined;
}
try {
  for (const volume of [original, migrated]) {
    call(["volume", "create", volume]);
    volumes.push(volume);
  }
  run(oldImage, original, "previous", "write");
  // Preserve the stopped baseline; only a separate copied volume is upgraded.
  call([
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "-v",
    `${original}:/source:ro`,
    "-v",
    `${migrated}:/destination`,
    "--entrypoint",
    "sh",
    newImage,
    "-ec",
    'test -z "$(ls -A /destination)"; cp -a /source/. /destination/',
  ]);
  run(newImage, migrated, "current", "read");
  run(newImage, migrated, "current", "read");
  run(oldImage, original, "previous", "read");
  console.log(
    JSON.stringify({
      oldImage,
      newImage,
      upgradeContinuity: true,
      preservedBaselineRollback: true,
      realAccountAcceptance: false,
    }),
  );
} finally {
  if (container) {
    try {
      console.error(call(["logs", "--tail", "60", container]));
    } catch {}
    try {
      call(["stop", "-t", "5", container]);
    } catch {}
    call(["rm", container]);
  }
  for (const volume of volumes) call(["volume", "rm", volume]);
  rmSync(directory, { recursive: true, force: true });
}
