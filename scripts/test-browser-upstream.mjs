import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stage = mkdtempSync(join(tmpdir(), "ftrade-upstream-test-"));
const repo = join(stage, "upstream");
const gitPath = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
const git = (...args) => {
  const result = spawnSync(gitPath, args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
try {
  mkdirSync(repo);
  git("init");
  git("config", "user.name", "SYNTHETIC test");
  git("config", "user.email", "synthetic@example.invalid");
  writeFileSync(join(repo, "fixture"), "SYNTHETIC upstream\n");
  git("add", "fixture");
  git("commit", "-m", "synthetic fixture");
  const pin = git("rev-parse", "HEAD");
  git("remote", "add", "origin", "https://github.com/jo-inc/camofox-browser.git");
  copyFileSync("ops/browser-node/prepare-upstream.sh", join(stage, "prepare-upstream.sh"));
  writeFileSync(join(stage, "camofox.ref"), `${pin}\n`);
  const bin = join(stage, "bin");
  mkdirSync(bin);
  // Trap only network fetches. All repository checks use real Git.
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase " $* " in *" fetch "*) echo attempted > ${quote(join(stage, "fetch"))}; exit 42 ;; esac\nexec ${quote(gitPath)} "$@"\n`,
    { mode: 0o700 },
  );
  const run = () =>
    spawnSync("sh", [join(stage, "prepare-upstream.sh")], {
      cwd: stage,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
  assert.equal(run().status, 0, "Cached exact commit must work without network");
  assert.equal(git("rev-parse", "HEAD"), pin);
  writeFileSync(join(repo, "fixture"), "SYNTHETIC local edit\n");
  assert.notEqual(run().status, 0, "Dirty source must be preserved and refused");
  assert.equal(readFileSync(join(repo, "fixture"), "utf8"), "SYNTHETIC local edit\n");
  git("restore", "fixture");
  git("remote", "set-url", "origin", "https://example.invalid/wrong.git");
  assert.notEqual(run().status, 0, "Wrong origin must be rejected even when cached");
  git("remote", "set-url", "origin", "https://github.com/jo-inc/camofox-browser.git");
  writeFileSync(join(stage, "camofox.ref"), `${"0".repeat(40)}\n`);
  assert.equal(run().status, 42, "Missing commit must fetch, not reuse another HEAD");
  assert.equal(readFileSync(join(stage, "fetch"), "utf8"), "attempted\n");
  assert.equal(git("rev-parse", "HEAD"), pin);
  writeFileSync(join(stage, "camofox.ref"), "main\n");
  assert.notEqual(run().status, 0, "Mutable ref must be rejected");
  console.log(
    "PASS upstream cache: exact pin offline, dirty tree, wrong origin, missing commit fetch, mutable ref rejection",
  );
} finally {
  rmSync(stage, { recursive: true, force: true });
}
