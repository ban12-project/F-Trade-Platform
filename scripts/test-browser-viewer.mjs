import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../ops/browser-node/viewer.js", import.meta.url), "utf8")
  .replace('"__APP_ORIGIN__"', '"https://app.example"')
  .replace("await import(module)", "await loadRfb(module)");
function fixture({
  fetchResult,
  loadResult,
  standalone = false,
  hash = "#11111111-1111-4111-8111-111111111111",
} = {}) {
  const events = new Map(),
    timers = new Map(),
    messages = [],
    requests = [],
    instances = [];
  let id = 0;
  const status = { textContent: "" };
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  class RFB {
    events = new Map();
    disconnected = 0;
    constructor() {
      instances.push(this);
    }
    addEventListener(name, listener) {
      this.events.set(name, listener);
    }
    disconnect() {
      this.disconnected++;
      this.events.get("disconnect")?.();
    }
    emit(name) {
      this.events.get(name)?.();
    }
  }
  const window = { parent, addEventListener: (name, listener) => events.set(name, listener) };
  if (standalone) window.parent = window;
  runInNewContext(source, {
    window,
    document: { getElementById: () => status },
    location: { host: "gateway.example", hash },
    AbortSignal,
    setInterval: (fn, ms) => {
      timers.set(++id, { fn, ms, repeat: true });
      return id;
    },
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    clearTimeout: (id) => timers.delete(id),
    fetch: async (...args) => {
      requests.push(args);
      if (fetchResult) return fetchResult();
      return {
        ok: true,
        json: async () => ({
          module: "/assets/module.js",
          websocket: "/ws/fixture",
          password: "fixture",
        }),
      };
    },
    loadRfb: loadResult ?? (async () => ({ default: RFB })),
  });
  return {
    self: window,
    status,
    messages,
    requests,
    instances,
    timers,
    send: (data, overrides = {}) =>
      events.get("message")({ source: parent, origin: "https://app.example", data, ...overrides }),
    tick(ms) {
      for (const [key, value] of [...timers])
        if (value.ms === ms) {
          if (!value.repeat) timers.delete(key);
          value.fn();
        }
    },
    hide: () => events.get("pagehide")(),
  };
}
const ticket = { type: "ftrade-browser-ticket", token: "one-use-fixture" };
test("lost initial readiness recovers with a late parent; duplicate delivery admits once", async () => {
  const f = fixture();
  const initial = f.messages.length;
  f.tick(500);
  assert.ok(f.messages.length > initial);
  assert.equal(f.requests.length, 0);
  await f.send(ticket);
  await f.send(ticket);
  assert.equal(f.requests.length, 1);
  assert.equal(f.instances.length, 1);
  assert.equal(f.requests[0][1].credentials, "omit");
  assert.equal(f.requests[0][1].cache, "no-store");
  assert.ok(f.requests[0][1].signal);
  f.instances[0].emit("connect");
  assert.match(f.status.textContent, /已连接/);
  assert.equal(f.timers.size, 0);
  await f.send({ type: "ftrade-browser-probe" });
  assert.equal(f.messages.at(-1).data.phase, "connected");
  f.instances[0].emit("disconnect");
  assert.match(f.status.textContent, /连接已断开/);
  await f.send(ticket);
  assert.equal(f.requests.length, 1);
  assert.ok(
    f.messages.every(
      (m) => m.origin === "https://app.example" && !JSON.stringify(m.data).includes(ticket.token),
    ),
  );
});
test("wrong origin or source cannot claim a ticket or probe state", async () => {
  const f = fixture();
  const count = f.messages.length;
  await f.send(ticket, { origin: "https://evil.example" });
  await f.send(ticket, { source: {} });
  await f.send({ type: "ftrade-browser-probe" }, { source: {} });
  assert.equal(f.requests.length, 0);
  assert.equal(f.messages.length, count);
});
test("missing parent and stalled admission fail bounded without automatic reauthorization", async () => {
  const f = fixture();
  f.tick(30_000);
  assert.match(f.status.textContent, /超时/);
  assert.equal(f.timers.size, 0);
  await f.send(ticket);
  assert.equal(f.requests.length, 0);
  let resolve;
  const g = fixture({
    fetchResult: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const pending = g.send(ticket);
  g.tick(30_000);
  resolve({
    ok: true,
    json: async () => ({ module: "/module", websocket: "/ws", password: "fixture" }),
  });
  await pending;
  assert.equal(g.instances.length, 0);
  assert.match(g.status.textContent, /超时/);
  await g.send(ticket);
  assert.equal(g.requests.length, 1);
});
test("rejected admission, module errors, security failure and page close stay closed", async () => {
  for (const options of [
    { fetchResult: async () => ({ ok: false }) },
    {
      loadResult: async () => {
        throw new Error("PRIVATE");
      },
    },
  ]) {
    const f = fixture(options);
    await f.send(ticket);
    assert.match(f.status.textContent, /未能建立/);
    assert.doesNotMatch(f.status.textContent, /PRIVATE/);
    assert.equal(f.timers.size, 0);
  }
  const f = fixture();
  await f.send(ticket);
  f.instances[0].emit("securityfailure");
  assert.match(f.status.textContent, /未能建立/);
  assert.equal(f.instances[0].disconnected, 1);
  const g = fixture();
  await g.send(ticket);
  g.hide();
  assert.equal(g.instances[0].disconnected, 1);
  assert.equal(g.timers.size, 0);
});

test("standalone viewer binds the platform probe and rejects unbound, self and foreign sources", async () => {
  const nonce = "11111111-1111-4111-8111-111111111111";
  const f = fixture({ standalone: true });
  const probe = { type: "ftrade-browser-probe", nonce };
  const boundTicket = { ...ticket, nonce };
  await f.send(boundTicket);
  await f.send(probe, { source: f.self });
  await f.send(probe, { origin: "https://evil.example" });
  await f.send({ ...probe, nonce: "wrong" });
  assert.equal(f.requests.length, 0);
  assert.equal(f.messages.length, 0);
  await f.send(probe);
  assert.equal(f.messages.at(-1).data.nonce, nonce);
  await f.send(boundTicket, { source: {} });
  await f.send(ticket);
  assert.equal(f.requests.length, 0);
  await f.send(boundTicket);
  await f.send(boundTicket);
  assert.equal(f.requests.length, 1);
  assert.equal(f.self.opener, null);
  assert.ok(f.messages.every((m) => !JSON.stringify(m.data).includes(ticket.token)));
  for (const hash of ["", "#wrong"]) {
    const g = fixture({ standalone: true, hash });
    await g.send(probe);
    await g.send(boundTicket);
    assert.equal(g.requests.length, 0);
  }
});
