import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const shadcn = createRequire(require.resolve("shadcn/mcp"));
const sdk = createRequire(shadcn.resolve("@modelcontextprotocol/sdk/server/index.js"));
const express = createRequire(sdk.resolve("express"));
const qs = express("qs");

test("Express query parser keeps nested parsing and bounded comma serialization", () => {
  assert.deepEqual(qs.parse("part[type]=disc&part[count]=2"), {
    part: { type: "disc", count: "2" },
  });
  assert.equal(
    qs.stringify({ part: ["disc", "cover"] }, { arrayFormat: "comma" }),
    "part=disc%2Ccover",
  );
  for (const encodeValuesOnly of [false, true]) {
    const payload = JSON.parse('{"part":[{"toString":"not-callable"}]}');
    assert.doesNotThrow(() => qs.stringify(payload, { arrayFormat: "comma", encodeValuesOnly }));
  }
  assert.equal(Object.hasOwn(qs.parse("__proto__[polluted]=yes"), "polluted"), false);
  assert.equal({}.polluted, undefined);
});

test("installed Hono adapter keeps static authorization aligned with decoded paths", async () => {
  const { Hono } = sdk("hono");
  const { serve } = sdk("@hono/node-server");
  const { serveStatic } = sdk("@hono/node-server/serve-static");
  const root = await mkdtemp(join(tmpdir(), "ftrade-synthetic-static-"));
  await mkdir(join(root, "static", "admin"), { recursive: true });
  await writeFile(join(root, "static", "admin", "private.txt"), "SYNTHETIC_PROTECTED");
  await writeFile(join(root, "static", "public file.txt"), "SYNTHETIC_PUBLIC");
  const app = new Hono();
  app.use("/static/admin/*", (c) => c.text("denied", 401));
  app.use("/static/*", serveStatic({ root }));
  let server;
  try {
    server = await new Promise((resolve) => {
      const handle = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () =>
        resolve(handle),
      );
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = (path) => fetch(base + path, { signal: AbortSignal.timeout(5000) });
    const publicFile = await get("/static/public%20file.txt");
    assert.equal(publicFile.status, 200);
    assert.equal(await publicFile.text(), "SYNTHETIC_PUBLIC");
    for (const path of ["/static/admin/private.txt", "/static/%61dmin/private.txt"]) {
      const denied = await get(path);
      assert.equal(denied.status, 401);
      assert.equal(await denied.text(), "denied");
    }
    const malformed = await get("/static/%%36%31dmin/private.txt");
    assert.equal(malformed.status, 404);
    assert.notEqual(await malformed.text(), "SYNTHETIC_PROTECTED");
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await rm(root, { recursive: true, force: true });
  }
});
