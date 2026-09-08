import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = await mkdtemp(join(tmpdir(), "ftrade-agent-payload-"));
try {
  const dockerfile = await readFile(join(root, "ops/browser-node/Dockerfile"), "utf8");
  const copies = dockerfile.split("\n").filter((line) => line.startsWith("COPY "));
  assert.ok(copies.length > 0, "Dockerfile must declare its runtime payload");
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  assert.equal(tracked.status, 0);
  const files = tracked.stdout.split("\0").filter(Boolean);
  // Stage only repository-tracked payload files; private runtime files are excluded.
  const inside = (base, value) => {
    const result = resolve(base, value);
    assert.ok(
      relative(base, result) &&
        !relative(base, result).startsWith(`..${sep}`) &&
        relative(base, result) !== "..",
    );
    return result;
  };
  for (const copy of copies) {
    const fields = copy.slice(5).trim().split(/\s+/);
    assert.ok(
      fields.length >= 2 && fields.every((field) => !/[[\]*?]/.test(field)),
      "Update the payload test for a changed COPY syntax",
    );
    const destination = fields.pop();
    assert.ok(destination.endsWith("/"));
    for (const source of fields) {
      const selected = source.endsWith("/")
        ? [...new Set(files.filter((file) => file.startsWith(source)))]
        : [source];
      assert.ok(selected.length > 0, "COPY source is empty");
      for (const file of selected) {
        assert.ok(
          !/(^|\/)(\.env($|\.)|profiles\/|node-state\/|upstream\/)/.test(file) ||
            /\.env\..*example$/.test(file) ||
            file.endsWith(".env.example"),
          "Private runtime data must not enter the smoke payload",
        );
        const suffix = source.endsWith("/") ? file.slice(source.length) : file.split("/").at(-1);
        const output = inside(stage, join(destination, suffix));
        await mkdir(dirname(output), { recursive: true });
        await copyFile(inside(root, file), output);
      }
    }
  }
  await writeFile(join(stage, "package.json"), '{"type":"module"}\n');
  const result = spawnSync(process.execPath, ["ops/browser-node/smoke.mjs", process.arch], {
    cwd: stage,
    encoding: "utf8",
    timeout: 30000,
    env: { PATH: process.env.PATH, TMPDIR: stage },
  });
  assert.equal(result.status, 0, result.stderr || "Offline Agent payload smoke failed");
  process.stdout.write(result.stdout);
  await rm(join(stage, "ops/browser-node/facebook-inbox-page.js"));
  const missingAsset = spawnSync(process.execPath, ["ops/browser-node/smoke.mjs", process.arch], {
    cwd: stage,
    encoding: "utf8",
    timeout: 30000,
    env: { PATH: process.env.PATH, TMPDIR: stage },
  });
  assert.notEqual(missingAsset.status, 0, "Missing page assets must fail the same runtime smoke");
  assert.ok(
    missingAsset.stderr.includes("ENOENT") &&
      missingAsset.stderr.includes("facebook-inbox-page.js"),
  );
  console.log("PASS negative control: removing a packaged page program fails the runtime smoke");
} finally {
  await rm(stage, { recursive: true, force: true });
}
