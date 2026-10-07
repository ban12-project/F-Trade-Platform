import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const workflowRequire = createRequire(require.resolve("workflow/api"));
const worldDirectory = dirname(workflowRequire.resolve("@workflow/world-vercel"));
const http = await import(pathToFileURL(join(worldDirectory, "http-client.js")));
const environmentKeys = [
  "WORKFLOW_VERCEL_QUEUE_TIMEOUT_MS",
  "WORKFLOW_VERCEL_QUEUE_CONNECTIONS",
  "WORKFLOW_VERCEL_HEADERS_TIMEOUT_MS",
  "WORKFLOW_VERCEL_BODY_TIMEOUT_MS",
  "WORKFLOW_NODE_HTTP",
  "WORKFLOW_VERCEL_BACKEND_URL",
];

async function withEnvironment(values, run) {
  const previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of environmentKeys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = String(values[key]);
    }
    return await run();
  } finally {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function stop(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("actual queue dispatcher bounds saturated connection waits", async (context) => {
  await withEnvironment(
    {
      WORKFLOW_VERCEL_QUEUE_TIMEOUT_MS: 5_000,
      WORKFLOW_VERCEL_QUEUE_CONNECTIONS: 1,
      WORKFLOW_VERCEL_HEADERS_TIMEOUT_MS: 5_000,
      WORKFLOW_VERCEL_BODY_TIMEOUT_MS: 5_000,
    },
    async () => {
      const arrivals = [];
      let activeRequests = 0;
      let peakRequests = 0;
      const { server, url } = await listen((request, response) => {
        arrivals.push({ method: request.method, path: request.url });
        activeRequests++;
        peakRequests = Math.max(peakRequests, activeRequests);
        response.once("close", () => activeRequests--);
        request.resume();
        // Synthetic stalled peer: accept the POST but never send headers.
      });
      let activeConnections = 0;
      let peakConnections = 0;
      server.on("connection", (socket) => {
        activeConnections++;
        peakConnections = Math.max(peakConnections, activeConnections);
        socket.on("close", () => activeConnections--);
      });
      // The fallback exists only for the pre-upgrade negative comparison. CI must meet
      // the same deadline assertion through the installed patched factory.
      const dispatcher = http.createQueueDispatcher?.() ?? http.getQueueDispatcher();
      const started = performance.now();
      const completed = [];
      const controllers = Array.from({ length: 10 }, () => new AbortController());
      const pending = Array.from({ length: 10 }, async (_, index) => {
        try {
          const response = await fetch(`${url}/SYNTHETIC_ack_${index}`, {
            method: "POST",
            body: "SYNTHETIC queue acknowledgment",
            dispatcher,
            signal: controllers[index].signal,
          });
          await response.text();
          completed.push({ index, elapsed: performance.now() - started, rejected: false });
        } catch {
          completed.push({ index, elapsed: performance.now() - started, rejected: true });
        }
      });
      let watchdog;
      try {
        await Promise.race([
          Promise.all(pending),
          new Promise((resolve) => {
            watchdog = setTimeout(resolve, 9_000);
          }),
        ]);
        context.diagnostic(
          JSON.stringify({
            completed: completed.length,
            arrivals: arrivals.length,
            peakConnections,
            peakRequests,
            latestMs: Math.round(Math.max(0, ...completed.map((entry) => entry.elapsed))),
          }),
        );
        assert.equal(
          completed.length,
          pending.length,
          "all queued POSTs must settle within one budget",
        );
        assert.ok(completed.every((entry) => entry.rejected && entry.elapsed < 9_000));
        assert.ok(arrivals.length >= 1);
        assert.equal(peakRequests, 1, "only one stalled HTTP request may occupy the queue pool");
        assert.equal(new Set(arrivals.map((entry) => entry.path)).size, arrivals.length);
        assert.ok(arrivals.every((entry) => entry.method === "POST"));
        // A RetryAgent composed outside its private-field owner can throw here.
        await dispatcher.close();
      } finally {
        clearTimeout(watchdog);
        for (const controller of controllers) controller.abort();
        try {
          await dispatcher.destroy();
        } finally {
          await stop(server);
          await Promise.all(pending);
        }
      }
    },
  );
});

test("queue limits have bounded defaults and reject unsafe configuration values", async () => {
  await withEnvironment({}, async () => {
    assert.equal(http.getQueueRequestTimeoutMs(), 30_000);
    const options = http.getQueueAgentOptions();
    assert.equal(options.connections, 64);
    assert.equal(options.headersTimeout, 30_000);
    assert.equal(options.bodyTimeout, 30_000);
    assert.equal(options.allowH2, false);
    assert.equal(options.pipelining, 1);
    assert.ok(options.connections > http.getAgentOptions().connections);
  });
  for (const [input, deadline, connections] of [
    ["0", 5_000, 1],
    ["-10", 5_000, 1],
    ["999999", 120_000, 1024],
    ["invalid", 30_000, 64],
  ]) {
    await withEnvironment(
      { WORKFLOW_VERCEL_QUEUE_TIMEOUT_MS: input, WORKFLOW_VERCEL_QUEUE_CONNECTIONS: input },
      async () => {
        assert.equal(http.getQueueRequestTimeoutMs(), deadline);
        const options = http.getQueueAgentOptions();
        assert.equal(options.connections, connections);
        assert.equal(options.headersTimeout, deadline);
        assert.equal(options.bodyTimeout, deadline);
      },
    );
  }
});

test("queue owns its dispatcher and preserves explicit transport overrides", async () => {
  await withEnvironment({}, async () => {
    const queue = http.getQueueDispatcher();
    const shared = http.getDispatcher();
    try {
      assert.equal(http.getQueueDispatcher(), queue);
      assert.notEqual(queue, shared);
      const custom = { synthetic: true };
      assert.equal(http.getQueueDispatcher({ dispatcher: custom }), custom);
      process.env.WORKFLOW_NODE_HTTP = "1";
      assert.equal(http.getQueueDispatcher(), undefined);
      assert.equal(http.getQueueDispatcher({ dispatcher: custom }), custom);
    } finally {
      await queue.close();
      await shared.close();
    }
  });
});

test("healthy POSTs succeed while failed POSTs are not automatically retried", async () => {
  await withEnvironment({}, async () => {
    const counts = new Map();
    const { server, url } = await listen((request, response) => {
      request.resume();
      const key = `${request.method} ${request.url}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      response.writeHead(request.url === "/ok" ? 200 : 503);
      response.end("SYNTHETIC queue transport response");
    });
    const dispatcher = http.createQueueDispatcher();
    try {
      const response = await fetch(`${url}/ok`, { method: "POST", dispatcher });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /SYNTHETIC/);
      await assert.rejects(
        fetch(`${url}/fail`, { method: "POST", dispatcher }),
        (error) => error.cause?.code === "UND_ERR_REQ_RETRY" && error.cause.statusCode === 503,
      );
      assert.equal(counts.get("POST /ok"), 1);
      assert.equal(counts.get("POST /fail"), 1);
      await dispatcher.close();
    } finally {
      await dispatcher.destroy();
      await stop(server);
    }
  });
});

test("caller abort releases the connection for the next queue POST", async () => {
  await withEnvironment({ WORKFLOW_VERCEL_QUEUE_CONNECTIONS: 1 }, async () => {
    const { server, url } = await listen((request, response) => {
      request.resume();
      if (request.url !== "/abort") response.end("SYNTHETIC recovered slot");
    });
    const dispatcher = http.createQueueDispatcher();
    const controller = new AbortController();
    const seen = once(server, "request", { signal: AbortSignal.timeout(5_000) });
    const pending = fetch(`${url}/abort`, {
      method: "POST",
      dispatcher,
      signal: controller.signal,
    }).then(
      (response) => ({ response }),
      (error) => ({ error }),
    );
    try {
      await seen;
      controller.abort();
      const result = await pending;
      assert.equal(result.error?.name, "AbortError");
      const response = await fetch(`${url}/next`, {
        method: "POST",
        dispatcher,
        signal: AbortSignal.timeout(2_000),
      });
      assert.equal(await response.text(), "SYNTHETIC recovered slot");
      await dispatcher.close();
    } finally {
      controller.abort();
      try {
        await dispatcher.destroy();
      } finally {
        await stop(server);
        await pending;
      }
    }
  });
});

test("configured queue concurrency bounds healthy in-flight requests", async () => {
  await withEnvironment({ WORKFLOW_VERCEL_QUEUE_CONNECTIONS: 2 }, async () => {
    let active = 0;
    let peak = 0;
    const timers = new Set();
    const { server, url } = await listen((request, response) => {
      request.resume();
      active++;
      peak = Math.max(peak, active);
      response.once("finish", () => active--);
      const timer = setTimeout(() => {
        timers.delete(timer);
        response.end("SYNTHETIC bounded concurrency");
      }, 40);
      timers.add(timer);
    });
    const dispatcher = http.createQueueDispatcher();
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, async (_, index) => {
          const response = await fetch(`${url}/SYNTHETIC_${index}`, {
            method: "POST",
            dispatcher,
            signal: AbortSignal.timeout(5_000),
          });
          assert.equal(response.status, 200);
          return response.text();
        }),
      );
      assert.ok(results.every((value) => value === "SYNTHETIC bounded concurrency"));
      assert.equal(peak, 2);
      await dispatcher.close();
    } finally {
      for (const timer of timers) clearTimeout(timer);
      await dispatcher.destroy();
      await stop(server);
    }
  });
});

test("actual Vercel queue client retains legacy JSON and current CBOR byte payloads", async () => {
  const received = [];
  const { server, url } = await listen(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({
      method: request.method,
      path: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks),
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ messageId: null }));
  });
  const originalFetch = globalThis.fetch;
  let dispatcher;
  try {
    await withEnvironment({ WORKFLOW_VERCEL_BACKEND_URL: url }, async () => {
      const { createQueue } = await import(pathToFileURL(join(worldDirectory, "queue.js")));
      const worldRequire = createRequire(join(worldDirectory, "index.js"));
      const { decode } = worldRequire("cbor-x");
      dispatcher = http.createQueueDispatcher();
      globalThis.fetch = (input, options) => {
        assert.equal(new URL(input).origin, url, "synthetic queue calls must remain on loopback");
        assert.equal(options.dispatcher, dispatcher);
        return originalFetch(input, { ...options, signal: AbortSignal.timeout(5_000) });
      };
      const { queue } = createQueue({
        token: "SYNTHETIC_queue_token",
        projectConfig: {
          projectId: "SYNTHETIC_project",
          teamId: "SYNTHETIC_team",
          environment: "preview",
        },
        dispatcher,
      });
      const deploymentId = "SYNTHETIC_deployment";
      const legacy = { runId: "SYNTHETIC_legacy_run", input: "SYNTHETIC legacy input" };
      const current = { runId: "SYNTHETIC_current_run", input: new Uint8Array([3, 7, 11]) };
      for (const [index, payload, specVersion] of [
        [0, legacy, 1],
        [1, current, 3],
      ]) {
        const result = await queue("SYNTHETIC/path", payload, {
          deploymentId,
          specVersion,
          idempotencyKey: `SYNTHETIC_key_${index}`,
        });
        assert.equal(result.messageId, null);
      }
      assert.equal(received.length, 2);
      for (const [index, request] of received.entries()) {
        assert.equal(request.method, "POST");
        assert.match(request.path, /^\/queues-proxy\//);
        assert.match(request.path, /SYNTHETIC-path/);
        assert.equal(request.headers.authorization, "Bearer SYNTHETIC_queue_token");
        assert.equal(request.headers["vqs-deployment-id"], deploymentId);
        assert.equal(request.headers["vqs-idempotency-key"], `SYNTHETIC_key_${index}`);
        assert.equal(
          request.headers["x-vercel-workflow-run-id"],
          index === 0 ? legacy.runId : current.runId,
        );
      }
      assert.equal(received[0].headers["content-type"], "application/json");
      assert.deepEqual(JSON.parse(received[0].body.toString()), {
        queueName: "SYNTHETIC/path",
        deploymentId,
        payload: legacy,
      });
      assert.equal(received[1].headers["content-type"], "application/cbor");
      const decoded = decode(received[1].body);
      assert.equal(decoded.queueName, "SYNTHETIC/path");
      assert.equal(decoded.deploymentId, deploymentId);
      assert.equal(decoded.payload.runId, current.runId);
      assert.ok(decoded.payload.input instanceof Uint8Array);
      assert.deepEqual([...decoded.payload.input], [3, 7, 11]);
      await dispatcher.close();
    });
  } finally {
    globalThis.fetch = originalFetch;
    await dispatcher?.destroy();
    await stop(server);
  }
});
