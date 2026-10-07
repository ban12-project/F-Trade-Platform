import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const workflowRequire = createRequire(require.resolve("workflow/api"));
const coreRequire = createRequire(workflowRequire.resolve("@workflow/core"));
const { createReplayNanoid } = await import(
  pathToFileURL(
    join(dirname(workflowRequire.resolve("@workflow/core/runtime")), "workflow/replay-nanoid.js"),
  )
);
const devalue = await import(pathToFileURL(coreRequire.resolve("devalue")));
const seedrandom = coreRequire("seedrandom");
const fixture = JSON.parse(
  await readFile(
    new URL("../data/fixtures/workflow-runtime-compatibility.synthetic.json", import.meta.url),
    "utf8",
  ),
);

// Workflow uses this fixed-size generator during replay. A patch must keep existing IDs stable.
for (const { seed, ids } of fixture.replay) {
  const random = seedrandom(seed);
  let draws = 0;
  const next = createReplayNanoid(() => {
    draws++;
    return random();
  });
  assert.deepEqual(
    Array.from({ length: ids.length }, () => next()),
    ids,
  );
  assert.equal(draws, 34 * ids.length);
  const expectedRandom = seedrandom(seed);
  for (let i = 0; i < draws; i++) expectedRandom();
  assert.equal(random(), expectedRandom());
}

// A payload written by the old runtime must remain readable after the patch.
const old = devalue.parse(fixture.devalue_wire);
assert.equal(old.name, "SYNTHETIC workflow data");
assert.equal(old.createdAt.toISOString(), "2026-01-01T00:00:00.000Z");
assert.equal(old.count, 42n);
assert.deepEqual([...old.labels], ["mock", "reference"]);
assert.equal(old.lookup.get("mock"), 7);
assert.deepEqual([...old.bytes], [1, 2, 3]);
assert.equal(old.self, old);
assert.equal(old.nested.enabled, true);
const revived = devalue.parse(devalue.stringify(old));
assert.equal(revived.self, revived);
assert.deepEqual([...revived.bytes], [1, 2, 3]);

// Buffer views must never serialize unrelated bytes from their backing allocation.
const backing = Buffer.alloc(128, 0x41);
backing.write("SYNTHETIC unrelated marker", 0, "utf8");
const visible = backing.subarray(64, 68);
visible.fill(0x42);
const decoded = devalue.parse(devalue.stringify(visible));
assert.deepEqual([...decoded], [0x42, 0x42, 0x42, 0x42]);
assert.equal(decoded.buffer.byteLength, visible.byteLength);
assert.equal(
  Buffer.from(decoded.buffer).includes(Buffer.from("SYNTHETIC unrelated marker")),
  false,
);

// Both worlds pass their pinned dispatcher to Node's global fetch. Keep that contract,
// including the retry agent's exclusion of non-idempotent POST requests.
const requests = new Map();
const server = createServer(async (request, response) => {
  for await (const _chunk of request) {
    // Consume the synthetic POST body before responding.
  }
  const key = `${request.method} ${request.url}`;
  const count = (requests.get(key) ?? 0) + 1;
  requests.set(key, count);
  response.writeHead(request.method === "POST" || count === 1 ? 503 : 200);
  response.end("SYNTHETIC transport response");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const world of ["@workflow/world-local", "@workflow/world-vercel"]) {
    const worldRequire = createRequire(workflowRequire.resolve(world));
    const { Agent, RetryAgent } = worldRequire("undici");
    const dispatcher = new RetryAgent(new Agent(), {
      maxRetries: 1,
      minTimeout: 1,
      maxTimeout: 1,
    });
    try {
      const path = `/${world.split("/")[1]}`;
      const get = await fetch(`${base}${path}`, {
        dispatcher,
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(get.status, 200);
      await get.text();
      assert.equal(requests.get(`GET ${path}`), 2);
      await assert.rejects(
        fetch(`${base}${path}`, {
          method: "POST",
          body: "SYNTHETIC mutation",
          dispatcher,
          signal: AbortSignal.timeout(5_000),
        }),
        (error) => error.cause?.code === "UND_ERR_REQ_RETRY" && error.cause.statusCode === 503,
      );
      assert.equal(requests.get(`POST ${path}`), 1);
    } finally {
      await dispatcher.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(
  "Workflow replay, legacy data, Buffer isolation and HTTP compatibility passed (synthetic)",
);
