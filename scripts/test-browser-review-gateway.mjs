import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { withAutomationControl } from "../ops/browser-node/control.mjs";
import { createGateway } from "../ops/browser-node/gateway.mjs";

async function fixture(upgradeDelay = 0) {
  const remoteSockets = new Set();
  let upgrades = 0;
  const upstream = http.createServer();
  upstream.on("upgrade", (request, socket) => {
    remoteSockets.add(socket);
    socket.on("error", () => {});
    setTimeout(() => {
      if (socket.destroyed) return;
      upgrades++;
      const accept = createHash("sha1")
        .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.on("data", (data) => socket.write(data));
    }, upgradeDelay);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const slot = {
    run: { id: randomUUID() },
    ready: true,
    stopping: false,
    expiresAt: Date.now() + 10_000,
    gatewayOrigin: "https://browser.example",
    vncPassword: "synthetic",
    vncPort: upstream.address().port,
  };
  const consumed = new Set();
  const gateway = createGateway({
    acquireControl: async (slot) => ({ expiresAt: slot.expiresAt, release: async () => {} }),
    appOrigin: "https://app.example",
    slots: new Map([[slot.run.id, slot]]),
    port: 0,
    nodeCall: async (_operation, { ticket }) => {
      if (
        !["synthetic-one-use-ticket", "synthetic-fresh-ticket"].includes(ticket) ||
        consumed.has(ticket)
      )
        throw new Error("denied");
      consumed.add(ticket);
      return { runId: slot.run.id };
    },
  });
  await once(gateway.server, "listening");
  const port = gateway.server.address().port;
  const result = await fetch(`http://127.0.0.1:${port}/admit`, {
    method: "POST",
    headers: {
      Origin: slot.gatewayOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ticket: "synthetic-one-use-ticket" }),
  });
  assert.equal(result.status, 200);
  const admission = await result.json();
  function connect(origin = slot.gatewayOrigin, capability = admission) {
    let socket;
    let closed = false;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: capability.websocket,
      headers: {
        Origin: origin,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.alloc(16, 3).toString("base64"),
      },
    });
    const connected = new Promise((resolve) => {
      req.on("upgrade", (_res, stream) => {
        socket = stream;
        stream.on("error", () => {});
        stream.on("close", () => {
          closed = true;
        });
        resolve(true);
      });
      req.on("error", () => {
        closed = true;
        resolve(false);
      });
      req.on("response", (res) => {
        res.resume();
        resolve(false);
      });
    });
    req.end();
    return {
      connected,
      get closed() {
        return closed;
      },
      get socket() {
        return socket;
      },
      destroy() {
        socket?.destroy();
        req.destroy();
      },
    };
  }
  return {
    slot,
    gateway,
    port,
    admission,
    connect,
    get upgrades() {
      return upgrades;
    },
    close() {
      gateway.close();
      gateway.server.closeAllConnections();
      for (const s of remoteSockets) s.destroy();
      upstream.close();
      upstream.closeAllConnections();
    },
  };
}

test("live authorized tunnel connects; the same websocket capability cannot replay", async () => {
  const f = await fixture();
  const a = f.connect();
  try {
    assert.equal(await a.connected, true);
    const replay = f.connect();
    assert.equal(await replay.connected, false);
    replay.destroy();
  } finally {
    a.destroy();
    f.close();
  }
});
test("wrong origin cannot upgrade even with a valid websocket capability", async () => {
  const f = await fixture();
  const a = f.connect("https://untrusted.example");
  try {
    assert.equal(await a.connected, false);
    assert.equal(f.upgrades, 0);
  } finally {
    a.destroy();
    f.close();
  }
});
test("an established tunnel expires without any Agent poll", async () => {
  const f = await fixture();
  const a = f.connect();
  try {
    assert.equal(await a.connected, true);
    f.slot.expiresAt = Date.now() - 1;
    await delay(700);
    assert.equal(a.closed, true, "expired websocket must close independently of Agent polling");
  } finally {
    a.destroy();
    f.close();
  }
});
test("close during upstream handshake cannot resurrect a revoked tunnel", async () => {
  const f = await fixture(180);
  const a = f.connect();
  try {
    await delay(50);
    f.gateway.closeRun(f.slot.run.id);
    assert.equal(
      await a.connected,
      false,
      "late upstream upgrade must not revive closed capability",
    );
  } finally {
    a.destroy();
    f.close();
  }
});
test("stopped run closes existing sockets and denies capability assets", async () => {
  const f = await fixture();
  const a = f.connect();
  try {
    assert.equal(await a.connected, true);
    f.slot.stopping = true;
    await delay(700);
    assert.equal(a.closed, true);
    const r = await fetch(`http://127.0.0.1:${f.port}${f.admission.module}`);
    assert.equal(r.status, 403);
    await r.text();
  } finally {
    a.destroy();
    f.close();
  }
});

test("admission binds Origin to the admitted run, not another slot", async () => {
  const victim = {
    run: { id: randomUUID() },
    ready: true,
    stopping: false,
    expiresAt: Date.now() + 10000,
    gatewayOrigin: "https://victim.example",
    vncPort: 1,
    vncPassword: "fixture-only",
  };
  const other = { ...victim, run: { id: randomUUID() }, gatewayOrigin: "https://other.example" };
  const gateway = createGateway({
    acquireControl: async (slot) => ({ expiresAt: slot.expiresAt, release: async () => {} }),
    appOrigin: "https://app.example",
    port: 0,
    slots: new Map([
      [victim.run.id, victim],
      [other.run.id, other],
    ]),
    nodeCall: async () => ({ runId: victim.run.id }),
  });
  try {
    await once(gateway.server, "listening");
    const response = await fetch(`http://127.0.0.1:${gateway.server.address().port}/admit`, {
      method: "POST",
      headers: { Origin: other.gatewayOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: "synthetic-valid-victim-ticket" }),
    });
    assert.equal(response.status, 403);
    assert.equal(await response.text(), "");
  } finally {
    gateway.close();
  }
});

test("fresh broker authorization revokes old tunnel and capabilities before replacement", async () => {
  const f = await fixture();
  const first = f.connect();
  let second;
  try {
    assert.equal(await first.connected, true);
    const response = await fetch(`http://127.0.0.1:${f.port}/admit`, {
      method: "POST",
      headers: { Origin: f.slot.gatewayOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: "synthetic-fresh-ticket" }),
    });
    assert.equal(response.status, 200);
    const replacement = await response.json();
    await delay(50);
    assert.equal(first.closed, true, "fresh admission must close the old tunnel");
    assert.notEqual(replacement.websocket, f.admission.websocket);
    const oldAssets = await fetch(`http://127.0.0.1:${f.port}${f.admission.module}`);
    assert.equal(oldAssets.status, 403);
    await oldAssets.text();
    const replay = f.connect();
    assert.equal(await replay.connected, false);
    replay.destroy();
    second = f.connect(f.slot.gatewayOrigin, replacement);
    assert.equal(await second.connected, true);
    await delay(100);
    assert.equal(first.closed, true);
    assert.equal(second.closed, false);
    assert.equal(
      f.slot.disconnectedAt,
      null,
      "old close callbacks must not disconnect replacement",
    );
    assert.equal(f.upgrades, 2);
    f.gateway.closeRun(f.slot.run.id);
    await delay(50);
    assert.equal(second.closed, true);
    assert.equal(typeof f.slot.disconnectedAt, "number");
  } finally {
    first.destroy();
    second?.destroy();
    f.close();
  }
});

// Real gateway -> backend HTTP calls; synthetic input backend, not Firefox proof.
async function controlFixture({
  delayGrant = false,
  delayRelease = false,
  failRelease = false,
} = {}) {
  const calls = [];
  let allowGrant;
  const barrier = new Promise((resolve) => {
    allowGrant = resolve;
  });
  const backend = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    calls.push({ path: request.url, body, headers: request.headers });
    assert.equal(request.headers.authorization, "Bearer backend-only-test-key");
    assert.equal(request.headers.origin, undefined);
    if (request.url === "/control/acquire") {
      if (delayGrant) await barrier;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          owner: body.userId,
          capability: "c".repeat(64),
          expiresAt: Date.now() + body.ttlMs,
        }),
      );
    } else {
      if (delayRelease) await barrier;
      response.writeHead(failRelease ? 503 : 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ released: !failRelease }));
    }
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const slot = {
    run: { id: randomUUID(), accountId: randomUUID() },
    apiPort: backend.address().port,
    accessKey: "backend-only-test-key",
    ready: true,
    stopping: false,
    expiresAt: Date.now() + 60000,
    gatewayOrigin: "https://browser.example",
    vncPort: 1,
    vncPassword: "fixture-only",
  };
  const gateway = createGateway({
    appOrigin: "https://app.example",
    slots: new Map([[slot.run.id, slot]]),
    port: 0,
    nodeCall: async () => ({ runId: slot.run.id }),
  });
  await once(gateway.server, "listening");
  const url = `http://127.0.0.1:${gateway.server.address().port}/admit`;
  return {
    slot,
    gateway,
    calls,
    allowGrant,
    admit: (signal) =>
      fetch(url, {
        method: "POST",
        headers: { Origin: slot.gatewayOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: "synthetic" }),
        signal,
      }),
    async close() {
      allowGrant();
      await gateway.closeRun(slot.run.id).catch(() => {});
      gateway.close();
      gateway.server.closeAllConnections();
      backend.closeAllConnections();
      await new Promise((resolve) => backend.close(resolve));
    },
  };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("condition not observed");
}
test("gateway waits for backend input grant and keeps control credentials backend-only", async () => {
  const f = await controlFixture({ delayGrant: true });
  try {
    let delivered = false;
    const pending = f.admit().then((r) => {
      delivered = true;
      return r;
    });
    await until(() => f.calls.length === 1);
    await delay(30);
    assert.equal(delivered, false);
    assert.equal(f.slot.controlPaused, true);
    f.allowGrant();
    const response = await pending;
    assert.equal(response.status, 200);
    const text = await response.text();
    assert(!text.includes("backend-only-test-key"));
    assert(!text.includes("c".repeat(64)));
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["module", "password", "websocket"]);
    await f.gateway.closeRun(f.slot.run.id);
    assert.equal(f.slot.controlPaused, false);
    assert.deepEqual(
      f.calls.map((c) => c.path),
      ["/control/acquire", "/control/release"],
    );
    assert.deepEqual(f.calls[1].body, { userId: f.slot.run.accountId, capability: "c".repeat(64) });
  } finally {
    await f.close();
  }
});
test("run revocation while backend starts releases late grant without admission", async () => {
  const f = await controlFixture({ delayGrant: true });
  try {
    const pending = f.admit();
    await until(() => f.calls.length === 1);
    const stopped = f.gateway.closeRun(f.slot.run.id);
    f.allowGrant();
    const response = await pending;
    assert.equal(response.status, 403);
    await response.text();
    await stopped;
    assert.equal(f.slot.controlPaused, false);
    assert.equal(f.calls[1].path, "/control/release");
  } finally {
    await f.close();
  }
});
test("abandoned admission releases backend grant after actual startup", async () => {
  const f = await controlFixture({ delayGrant: true });
  const abort = new AbortController();
  try {
    const pending = f.admit(abort.signal);
    await until(() => f.calls.length === 1);
    abort.abort();
    await assert.rejects(pending);
    await delay(30);
    f.allowGrant();
    await until(() => f.calls.length === 2);
    await until(() => !f.slot.controlPaused);
    assert.equal(f.calls[1].path, "/control/release");
  } finally {
    await f.close();
  }
});
test("failed backend release forbids a fresh grant and keeps automation paused", async () => {
  const f = await controlFixture({ failRelease: true });
  try {
    const first = await f.admit();
    assert.equal(first.status, 200);
    await first.text();
    const second = await f.admit();
    assert.equal(second.status, 403);
    await second.text();
    assert.equal(f.slot.controlPaused, true);
    assert.equal(f.slot.controlFailure, true);
    const third = await f.admit();
    assert.equal(third.status, 403);
    await third.text();
    assert.equal(f.calls.filter((c) => c.path === "/control/acquire").length, 1);
  } finally {
    await f.close();
  }
});

test("closeRun waits for release already started by another revocation", async () => {
  const f = await controlFixture({ delayRelease: true });
  try {
    const response = await f.admit();
    await response.text();
    const first = f.gateway.closeRun(f.slot.run.id);
    await until(() => f.calls.length === 2);
    let done = false;
    const second = f.gateway.closeRun(f.slot.run.id).then(() => {
      done = true;
    });
    await delay(30);
    assert.equal(done, false);
    assert.equal(f.slot.controlPaused, true);
    f.allowGrant();
    await Promise.all([first, second]);
    assert.equal(f.slot.controlPaused, false);
  } finally {
    await f.close();
  }
});

test("saved automation handoff waits for input cleanup and denies fresh viewers until done", async () => {
  const f = await controlFixture({ delayRelease: true });
  try {
    const response = await f.admit();
    await response.text();
    let executed = false;
    const operation = withAutomationControl(f.slot, f.gateway, async () => {
      executed = true;
      assert.equal(f.slot.controlPaused, false);
      const denied = await f.admit();
      assert.equal(denied.status, 403);
      await denied.text();
      return "filled";
    });
    await until(() => f.calls.length === 2);
    assert.equal(executed, false);
    assert.equal(f.slot.automationHandoff, true);
    f.allowGrant();
    assert.equal(await operation, "filled");
    assert.equal(f.slot.automationHandoff, false);
    assert.equal(f.calls.filter((c) => c.path === "/control/acquire").length, 1);
    const next = await f.admit();
    assert.equal(next.status, 200);
    await next.text();
  } finally {
    await f.close();
  }
});
