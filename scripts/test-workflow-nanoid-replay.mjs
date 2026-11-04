import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Never feed ULID-numbered v4 events to the slot-numbered v5 runtime.
// Reproduce the retained deployment's exact code, patch and dependency graph instead.
// This proves the synthetic v4 state can finish there, NOT that a real deployment is retained.
const baseline = "8194706c7199e89dc4fa1684977d088dcd4c0c60";
const directory = await mkdtemp(join(tmpdir(), "ftrade-v4-replay-"));
try {
  const archive = execFileSync("git", ["archive", baseline], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", directory], { input: archive });
  for (const name of ["workflow-nanoid-replay", "workflow-runtime-compatibility"]) {
    const path = `data/fixtures/${name}.synthetic.json`;
    assert.deepEqual(
      await readFile(new URL(`../${path}`, import.meta.url)),
      await readFile(join(directory, path)),
      "Historical SDK fixtures must remain byte-for-byte unchanged",
    );
  }
  execFileSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: directory,
    stdio: "inherit",
  });
  const childEnvironment = { ...process.env };
  // node --test marks descendants; do not let nested runners silently skip every test.
  delete childEnvironment.NODE_TEST_CONTEXT;
  for (const script of [
    "scripts/test-workflow-security-compatibility.mjs",
    "scripts/test-workflow-nanoid-replay.mjs",
  ]) {
    const output = execFileSync(process.execPath, ["--test", "--test-reporter=tap", script], {
      cwd: directory,
      env: childEnvironment,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.match(output, /# fail 0/);
    assert.match(output, script.includes("nanoid-replay") ? /# pass 2/ : /# pass 1/);
    console.log(output);
  }
  console.log(`Synthetic legacy replay passed on isolated v4 baseline ${baseline}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
