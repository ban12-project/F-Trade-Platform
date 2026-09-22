import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { acquireBrowserControl } from "./control.mjs";

export function safeAssetPath(value) {
  let path;
  try {
    path = decodeURIComponent(value);
  } catch {
    throw new Error("invalid_asset_path");
  }
  if (
    !/^\/(core|vendor|app)\/[A-Za-z0-9_./-]+\.(js|css|png|svg|woff2?)$/.test(path) ||
    path.split("/").includes("..")
  )
    throw new Error("invalid_asset_path");
  return path;
}
async function readBody(request) {
  const parts = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 512) throw new Error("request_limit");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
export function createGateway({ appOrigin, nodeCall, slots, port = 9400, acquireControl = acquireBrowserControl }) {
  const views = new Map();
  const queues = new WeakMap();
  const generations = new WeakMap();
  const releases = new WeakMap();
  let closing = false;
  function serial(slot, operation) {
    const pending = (queues.get(slot) || Promise.resolve()).catch(() => {}).then(operation);
    queues.set(slot, pending); return pending;
  }
  function allowed(entry) {
    return (
      !!entry &&
      !closing &&
      !entry.closed &&
      entry.control.expiresAt > Date.now() &&
      !entry.slot.stopping &&
      slots.get(entry.slot.run.id) === entry.slot &&
      entry.slot.expiresAt > Date.now()
    );
  }
  function dispose(key, entry) {
    if (entry.closed) return entry.cleanup;
    entry.closed = true;
    entry.slot.disconnectedAt = Date.now();
    for (const request of entry.requests) request.destroy();
    for (const socket of entry.sockets) socket.destroy();
    views.delete(key);
    entry.cleanup = Promise.resolve().then(() => entry.control.release());
    if (!releases.has(entry.slot)) releases.set(entry.slot, new Set());
    const pending = releases.get(entry.slot); pending.add(entry.cleanup);
    entry.cleanup.then(() => pending.delete(entry.cleanup), () => { entry.slot.controlFailure = true; });
    return entry.cleanup;
  }
  // Established tunnels need their own expiry check, even while a Docker call
  // blocks the Agent's next poll. Handshake-only checks do not revoke a tunnel.
  const expiryTimer = setInterval(() => {
    for (const [key, entry] of views) {
      if (!allowed(entry) || (!entry.used && Date.now() - entry.createdAt > 30_000))
        dispose(key, entry);
    }
  }, 250);
  expiryTimer.unref();
  const source = readFileSync(new URL("./viewer.js", import.meta.url), "utf8");
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${appOrigin}`,
    );
    const fail = () => {
      if (!response.headersSent) response.writeHead(403);
      response.end();
    };
    try {
      if (request.method === "GET" && request.url === "/viewer") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          '<!doctype html><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>F-Trade browser</title><body style="margin:0"><div id="status">正在授权连接…</div><div id="screen" style="height:90vh"></div><script type="module" src="/viewer.js"></script>',
        );
        return;
      }
      if (request.method === "GET" && request.url === "/viewer.js") {
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.end(source.replace('"__APP_ORIGIN__"', JSON.stringify(appOrigin)));
        return;
      }
      if (request.method === "POST" && request.url === "/admit") {
        const origin = request.headers.origin;
        // Admission comes from our own iframe, not arbitrary cross-origin forms.
        if (!origin || ![...slots.values()].some((s) => s.gatewayOrigin === origin)) return fail();
        const input = await readBody(request);
        if (typeof input.ticket !== "string" || Object.keys(input).length !== 1) return fail();
        const admission = await nodeCall("admit", { ticket: input.ticket });
        const slot = slots.get(admission.runId);
        if (
          !slot?.ready ||
          slot.stopping ||
          slot.expiresAt <= Date.now() ||
          origin !== slot.gatewayOrigin
        )
          return fail();
        const generation = generations.get(slot) || 0;
        await serial(slot, async () => {
          const active = () => !closing && !response.destroyed && !slot.stopping && !slot.automationHandoff &&
            slots.get(slot.run.id) === slot && slot.expiresAt > Date.now() &&
            (generations.get(slot) || 0) === generation;
          if (!active()) throw new Error("admission_cancelled");
          // Finish revoking old input before asking the backend for a new grant.
          for (const [key, entry] of views) {
            if (entry.slot === slot) await dispose(key, entry);
          }
          if (!active()) throw new Error("admission_cancelled");
          const control = await acquireControl(slot);
          if (!active() || control.expiresAt <= Date.now()) {
            await control.release(); throw new Error("admission_cancelled");
          }
          const view = randomBytes(32).toString("base64url");
          const ws = randomBytes(32).toString("base64url");
          const entry = { slot, control, ws, used: false, closed: false,
            createdAt: Date.now(), sockets: new Set(), requests: new Set() };
          views.set(view, entry);
          // A response lost before delivery must not strand a backend grant.
          let delivered = false;
          response.once("finish", () => { delivered = true; });
          response.once("close", () => { if (!delivered) dispose(view, entry); });
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ module: `/assets/${view}/core/rfb.js`,
            websocket: `/ws/${view}/${ws}`, password: slot.vncPassword }));
        });
        return;
      }
      const match = /^\/assets\/([A-Za-z0-9_-]{43})(\/.*)$/.exec(request.url ?? "");
      if (request.method !== "GET" || !match) return fail();
      const entry = views.get(match[1]);
      if (!allowed(entry)) return fail();
      const path = safeAssetPath(match[2]);
      const upstream = await fetch(`http://127.0.0.1:${entry.slot.vncPort}${path}`, {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return fail();
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of upstream.body) {
        size += chunk.byteLength;
        if (size > 2_000_000 || !allowed(entry)) return fail();
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      response.setHeader(
        "Content-Type",
        upstream.headers.get("content-type") ?? "application/octet-stream",
      );
      response.end(Buffer.from(data));
    } catch {
      fail();
    }
  });
  server.on("upgrade", (request, socket, head) => {
    const match = /^\/ws\/([A-Za-z0-9_-]{43})\/([A-Za-z0-9_-]{43})$/.exec(request.url ?? "");
    const entry = match && views.get(match[1]);
    if (
      !allowed(entry) ||
      entry.used ||
      entry.ws !== match[2] ||
      Date.now() - entry.createdAt > 30_000 ||
      request.headers.origin !== entry.slot.gatewayOrigin
    ) {
      socket.destroy();
      return;
    }
    entry.used = true;
    // Register pending sockets before contacting upstream so closeRun also
    // cancels a handshake that has not reached its upgrade callback yet.
    entry.sockets.add(socket);
    const proxy = http.request({
      hostname: "127.0.0.1",
      port: entry.slot.vncPort,
      path: "/websockify",
      method: "GET",
      headers: {
        host: `127.0.0.1:${entry.slot.vncPort}`,
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": request.headers["sec-websocket-key"],
        "sec-websocket-version": "13",
        ...(request.headers["sec-websocket-protocol"]
          ? { "sec-websocket-protocol": request.headers["sec-websocket-protocol"] }
          : {}),
      },
    });
    entry.requests.add(proxy);
    const close = () => dispose(match[1], entry);
    socket.once("close", close);
    socket.once("error", close);
    proxy.setTimeout(10_000, close);
    proxy.on("error", close);
    proxy.on("response", close);
    proxy.on("upgrade", (response, upstream, upstreamHead) => {
      proxy.setTimeout(0);
      if (!allowed(entry) || socket.destroyed || views.get(match[1]) !== entry) {
        upstream.destroy();
        close();
        return;
      }
      entry.slot.connected = true;
      entry.slot.disconnectedAt = null;
      entry.sockets.add(upstream);
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n")}\r\n\r\n`,
      );
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
      // Both ends share idempotent disposal, including asset revocation.
      upstream.on("close", close);
      socket.on("error", close);
      upstream.on("error", close);
    });
    proxy.end();
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.listen(port, "127.0.0.1");
  return {
    server,
    closeRun(runId) {
      const slot = slots.get(runId);
      if (!slot) return Promise.resolve();
      generations.set(slot, (generations.get(slot) || 0) + 1);
      const cleanups = [];
      for (const [key, entry] of views) if (entry.slot === slot) cleanups.push(dispose(key, entry));
      return serial(slot, () => Promise.all([...cleanups, ...(releases.get(slot) || [])]));
    },
    close() {
      closing = true;
      clearInterval(expiryTimer);
      for (const [key, entry] of views) dispose(key, entry);
      server.close();
    },
  };
}
