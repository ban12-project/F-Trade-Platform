import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = createRequire(import.meta.url);
const core = createRequire(createRequire(root.resolve("workflow")).resolve("@workflow/core"));
const clients = [
  ["Blob", createRequire(root.resolve("@vercel/blob"))],
  ["Sandbox", createRequire(root.resolve("@vercel/sandbox"))],
  ["Workflow local", createRequire(core.resolve("@workflow/world-local"))],
  ["Workflow Vercel", createRequire(core.resolve("@workflow/world-vercel"))],
];
const directory = await mkdtemp(join(tmpdir(), "ftrade-synthetic-tls-"));
const keyPath = join(directory, "key.pem"),
  certPath = join(directory, "cert.pem");
// Ephemeral loopback-only CA/certificate. Never disable TLS verification.
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "pipe", timeout: 15000 },
);
const cert = await readFile(certPath, "utf8");
let requests = 0;
const server = createServer({ key: await readFile(keyPath), cert }, (_req, res) => {
  requests++;
  res.end("SYNTHETIC TLS transport");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = `https://127.0.0.1:${server.address().port}/`;
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});
for (const [label, parent] of clients) {
  test(`${label}: trusted TLS works and custom certificate rejection reaches Agent`, async () => {
    const { Agent, request } = parent("undici");
    const control = new Agent({ tls: { ca: cert } });
    try {
      const response = await request(url, {
        dispatcher: control,
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.statusCode, 200);
      assert.equal(await response.body.text(), "SYNTHETIC TLS transport");
    } finally {
      await control.destroy();
    }
    let checks = 0;
    const before = requests;
    const guarded = new Agent({
      tls: {
        ca: cert,
        checkServerIdentity: () => {
          checks++;
          return Object.assign(new Error("Synthetic certificate pin rejection"), {
            code: "SYNTHETIC_TLS_PIN",
          });
        },
      },
    });
    try {
      await assert.rejects(
        async () => {
          const response = await request(url, {
            dispatcher: guarded,
            signal: AbortSignal.timeout(5000),
          });
          await response.body.text();
        },
        { code: "SYNTHETIC_TLS_PIN" },
      );
      assert.ok(checks > 0);
      assert.equal(requests, before, "rejected TLS must not send an HTTP request");
    } finally {
      await guarded.destroy();
    }
  });
}
