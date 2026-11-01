import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareRenderWorkspace } from "../ops/vps-runtime/render-workspace.mjs";

test("renderer and its children allocate scratch files inside the job workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "remotion-workspace-test-"));
  const previous = process.env.TMPDIR;
  try {
    await prepareRenderWorkspace(root);
    assert.equal(tmpdir(), join(root, "tmp"));
    const childPath = execFileSync(
      process.execPath,
      [
        "-e",
        "console.log(require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'renderer-')))",
      ],
      { encoding: "utf8" },
    ).trim();
    assert.ok(childPath.startsWith(join(root, "tmp", "renderer-")));
    await prepareRenderWorkspace(root);
    assert.equal(tmpdir(), join(root, "tmp"));
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
