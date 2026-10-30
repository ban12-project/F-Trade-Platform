import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = createRequire(import.meta.url);
const mcp = createRequire(
  createRequire(root.resolve("shadcn")).resolve("@modelcontextprotocol/sdk/server/index.js"),
);
const cli = createRequire(
  createRequire(root.resolve("workflow")).resolve("@workflow/cli/package.json"),
);
const web = createRequire(cli.resolve("@workflow/web/package.json"));
const parents = [
  ["MCP tooling", mcp],
  ["Workflow web", web],
];

if (process.argv[2] === "worker") {
  // A vulnerable parser can terminate its process: keep every probe in a bounded child.
  const express = root(process.argv[3]);
  const scenario = process.argv[4];
  const app = express();
  app.use(express.json({ limit: "1kb", verify: () => {} }));
  app.use(express.urlencoded({ extended: false, limit: "1kb" }));
  app.use((req, res) => res.json(req.body));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ type: error.type }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  async function post(body, contentType = "application/json", encoding) {
    return await new Promise((resolve, reject) => {
      const headers = { "content-type": contentType, "content-length": body.length };
      if (encoding) headers["content-encoding"] = encoding;
      const req = request(
        { host: "127.0.0.1", port: server.address().port, method: "POST", agent: false, headers },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("error", reject);
          res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        },
      );
      req.setTimeout(2000, () => req.destroy(new Error("loopback request timeout")));
      req.on("error", reject);
      req.end(body);
    });
  }
  try {
    const valid = Buffer.from(JSON.stringify({ synthetic: true }));
    if (scenario === "trailing") {
      // Bounded compressed frame followed by padding and invalid trailing bytes.
      // See GHSA-27r3-jxmh-p828; no external host or production input is used.
      const payload = Buffer.concat([gzipSync(valid), Buffer.of(0), Buffer.alloc(100 * 1024, 88)]);
      assert.deepEqual(await post(payload, "application/json", "gzip"), {
        status: 200,
        body: { synthetic: true },
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const rejected = await post(payload, "application/json; charset=utf-999", "gzip");
      assert.equal(rejected.status, 415);
      await new Promise((resolve) => setTimeout(resolve, 250));
    } else {
      assert.deepEqual(await post(gzipSync(valid), "application/json", "gzip"), {
        status: 200,
        body: { synthetic: true },
      });
      assert.deepEqual(
        await post(Buffer.from("label=synthetic&count=2"), "application/x-www-form-urlencoded"),
        { status: 200, body: { label: "synthetic", count: "2" } },
      );
      assert.equal((await post(Buffer.from("{"))).status, 400);
      assert.equal(
        (await post(Buffer.from(JSON.stringify({ text: "x".repeat(2048) })))).status,
        413,
      );
    }
    assert.deepEqual(await post(valid), { status: 200, body: { synthetic: true } });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
} else {
  for (const [name, parent] of parents) {
    for (const scenario of ["trailing", "controls"]) {
      test(`${name}: ${scenario}, then subsequent request remains healthy`, () => {
        const child = spawnSync(
          process.execPath,
          [fileURLToPath(import.meta.url), "worker", parent.resolve("express"), scenario],
          { encoding: "utf8", timeout: 10000, maxBuffer: 64 * 1024 },
        );
        assert.equal(child.error, undefined);
        assert.equal(child.status, 0, child.stderr || `signal: ${child.signal}`);
      });
    }
  }
}
