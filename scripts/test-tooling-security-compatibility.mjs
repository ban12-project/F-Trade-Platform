import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const drizzleRequire = createRequire(require.resolve("drizzle-kit"));
const loaderRequire = createRequire(drizzleRequire.resolve("@esbuild-kit/esm-loader"));
const corePath = loaderRequire.resolve("@esbuild-kit/core-utils");
const core = require(corePath);
const esbuild = createRequire(corePath)("esbuild");

test("legacy loader retains TypeScript CJS/ESM execution and source maps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ftrade-synthetic-loader-"));
  const source =
    "interface Entry { value: number }; const entry: Entry = { value: 21 }; export const answer = entry.value * 2;";
  const esmSource = "export const answer: number = 42;";
  const checkMap = (value, filename, originalSource) => {
    // source-map-support accepts serialized maps and RawSourceMap objects; cache hits use objects.
    const map = typeof value === "string" ? JSON.parse(value) : value;
    assert.equal(map.version, 3);
    assert.ok(map.mappings.length > 0);
    assert.ok(map.sources.some((name) => name.endsWith(filename)));
    assert.ok(map.sourcesContent.includes(originalSource));
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cjs = core.transformSync(source, join(directory, "tooling.cts"), { format: "cjs" });
      const module = { exports: {} };
      runInNewContext(cjs.code, { module, exports: module.exports });
      assert.equal(module.exports.answer, 42);
      checkMap(cjs.map, "tooling.cts", source);
      const esm = await core.transform(esmSource, join(directory, "tooling.mts"), {
        format: "esm",
      });
      const result = await import(
        `data:text/javascript;base64,${Buffer.from(esm.code).toString("base64")}`
      );
      assert.equal(result.answer, 42);
      checkMap(esm.map, "tooling.mts", esmSource);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the exact loader esbuild does not grant foreign-origin reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ftrade-synthetic-esbuild-"));
  const context = await esbuild.context({
    stdin: { contents: 'console.log("SYNTHETIC served output");', resolveDir: directory },
    outfile: join(directory, "output.js"),
    logLevel: "silent",
  });
  try {
    const { port } = await context.serve({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`http://127.0.0.1:${port}/output.js`, {
      headers: { Origin: "https://foreign.synthetic.invalid" },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /SYNTHETIC served output/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    await context.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
