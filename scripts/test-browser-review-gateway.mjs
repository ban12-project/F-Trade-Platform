import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
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
  let consumed = false;
  const gateway = createGateway({
    appOrigin: "https://app.example",
    slots: new Map([[slot.run.id, slot]]),
    port: 0,
    nodeCall: async (_operation, { ticket }) => {
      if (ticket !== "synthetic-one-use-ticket" || consumed) throw new Error("denied");
      consumed = true;
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
  function connect(origin = slot.gatewayOrigin) {
    let socket;
    let closed = false;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: admission.websocket,
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
    assert.equal(await a.connected, false, "late upstream upgrade must not revive closed capability");
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
