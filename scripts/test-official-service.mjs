import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRuntimeService } from "../ops/browser-node/official-runtime/service.mjs";
import { scheduleBrowserRequest } from "../ops/browser-node/request-queue.mjs";

const accountId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const accessKey = "SYNTHETIC-official-runtime-key-only";
async function fixture(t, options = {}) {
  const context = new EventEmitter();
  let closed = false,
    evaluation = async () => "synthetic",
    evaluations = 0;
  const pages = [];
  const browser = { isConnected: () => !closed };
  Object.assign(context, {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    pages: () => pages,
    close: async () => {
      closed = true;
    },
    async newPage() {
      const page = new EventEmitter();
      let url = "about:blank",
        pageClosed = false;
      Object.assign(page, {
        goto: async (next) => {
          url = next;
        },
        url: () => url,
        isClosed: () => pageClosed,
        bringToFront: async () => {},
        close: async () => {
          pageClosed = true;
          page.emit("close");
        },
        evaluate: async (...args) => {
          evaluations++;
          return evaluation(...args);
        },
        locator: () => ({ ariaSnapshot: async () => '- generic: "192.0.2.40"' }),
      });
      pages.push(page);
      context.emit("page", page);
      return page;
    },
  });
  const runtime = createRuntimeService({
    launcher: {
      assertAccount(id) {
        assert.equal(id, accountId);
      },
      ensureBrowser: async () => browser,
      contextFor: async () => context,
    },
    accountId,
    runId,
    accessKey,
    leaseDeadline: () => Date.now() + 30000,
    viewer: { status: async () => true },
    registerIntegrations: false,
    ...options,
  });
  const server = await new Promise((resolve) => {
    const server = runtime.app.listen(0, "127.0.0.1", () => resolve(server));
  });
  t.after(async () => {
    await runtime.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const request = async (path, body, authorized = true, method) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...(authorized ? { authorization: `Bearer ${accessKey}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const tab = async () => {
    const response = await request("/tabs", {
      userId: accountId,
      sessionKey: runId,
      url: "https://www.facebook.com/",
      trace: false,
    });
    assert.equal(response.status, 200);
    return response.body.tabId;
  };
  return {
    runtime,
    request,
    tab,
    pages,
    setEvaluation: (fn) => {
      evaluation = fn;
    },
    evaluations: () => evaluations,
  };
}

test("Agent serializes a live observation and egress navigation against the actual service", async (t) => {
  const f = await fixture(t);
  const tab = await f.tab();
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const finish = new Promise((resolve) => {
    release = resolve;
  });
  f.setEvaluation(async () => {
    entered();
    await finish;
    return true;
  });
  const slot = { expiresAt: Date.now() + 30000, abort: new AbortController() };
  const first = scheduleBrowserRequest(
    slot,
    () =>
      f.request(`/tabs/${tab}/evaluate`, {
        userId: accountId,
        expression: "synthetic observation",
      }),
    slot.abort.signal,
  );
  await started;
  const second = scheduleBrowserRequest(
    slot,
    () =>
      f.request(`/tabs/${tab}/navigate`, {
        userId: accountId,
        url: "https://api.ipify.org/",
      }),
    slot.abort.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
});

test("authenticates health and scopes every created page to account and run", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/health", undefined, false)).status, 401);
  assert.equal((await f.request("/health")).body.browserConnected, false);
  assert.equal(
    (
      await f.request("/tabs", {
        userId: runId,
        sessionKey: runId,
        url: "https://www.facebook.com/",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/tabs", {
        userId: accountId,
        sessionKey: accountId,
        url: "https://www.facebook.com/",
      })
    ).status,
    403,
  );
  assert.equal(f.pages.length, 0);
  const id = await f.tab();
  assert.equal((await f.request("/health")).body.browserConnected, true);
  assert.equal(
    (await f.request(`/tabs/${id}/evaluate`, { userId: runId, expression: "1" })).status,
    403,
  );
  assert.equal(f.evaluations(), 0);
});

test("retains egress shape, disallows unreviewed URL and does not export storage", async (t) => {
  const f = await fixture(t),
    id = await f.tab();
  assert.equal(
    (await f.request(`/tabs/${id}/navigate`, { userId: accountId, url: "http://127.0.0.1/" }))
      .status,
    400,
  );
  const navigation = await f.request(`/tabs/${id}/navigate`, {
    userId: accountId,
    url: "https://api.ipify.org/",
  });
  assert.equal(navigation.body.tabId, id);
  const snapshot = await f.request(
    `/tabs/${id}/snapshot?userId=${accountId}&format=json&includeScreenshot=false`,
  );
  assert.equal(snapshot.body.url, "https://api.ipify.org/");
  assert.equal(snapshot.body.snapshot, '- generic: "192.0.2.40"');
  assert.equal(snapshot.body.truncated, false);
  assert.deepEqual((await f.request(`/sessions/${accountId}/storage_state`)).body, {
    ok: true,
    persistence: "native",
  });
});

test("does not retry failed evaluation or expose raw credential-bearing errors", async (t) => {
  const f = await fixture(t),
    id = await f.tab();
  f.setEvaluation(async () => {
    throw new Error("SECRET-SYNTHETIC-only");
  });
  const result = await f.request(`/tabs/${id}/evaluate`, {
    userId: accountId,
    expression: "test()",
  });
  assert.equal(result.status, 500);
  assert.equal(result.body.retryable, false);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  assert.equal(f.evaluations(), 1);
  f.setEvaluation(async () => {
    throw new Error("Execution context was destroyed, most likely because of a navigation");
  });
  const navigation = await f.request(`/tabs/${id}/evaluate`, {
    userId: accountId,
    expression: "read()",
  });
  assert.equal(navigation.status, 409);
  assert.equal(navigation.body.code, "navigation_race");
  assert.equal(f.evaluations(), 2);
});

test("a concurrent request never repeats an in-flight operation", async (t) => {
  const f = await fixture(t),
    id = await f.tab();
  let resolve, entered;
  const started = new Promise((r) => {
    entered = r;
  });
  f.setEvaluation(() => {
    entered();
    return new Promise((r) => {
      resolve = r;
    });
  });
  const first = f.request(`/tabs/${id}/evaluate`, {
    userId: accountId,
    expression: "submitOnce()",
  });
  await started;
  const second = await f.request(`/tabs/${id}/evaluate`, {
    userId: accountId,
    expression: "submitOnce()",
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "runtime_busy");
  resolve("done");
  assert.equal((await first).status, 200);
  assert.equal(f.evaluations(), 1);
});

test("timed-out operation fences the runtime even if its work later finishes", async (t) => {
  let fatal = 0,
    resolve;
  const f = await fixture(t, {
      operationTimeoutMs: 100,
      onFatal: () => {
        fatal++;
      },
    }),
    id = await f.tab();
  f.setEvaluation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const result = await f.request(`/tabs/${id}/evaluate`, {
    userId: accountId,
    expression: "pendingSideEffect()",
  });
  assert.equal(result.status, 504);
  assert.equal(result.body.code, "operation_unknown");
  assert.equal(fatal, 1);
  assert.equal(f.evaluations(), 1);
  resolve("late");
  assert.equal((await f.request("/health")).status, 403);
});

test("expired lease rejects requests before launching or acting", async (t) => {
  const f = await fixture(t, { leaseDeadline: () => Date.now() - 1 });
  assert.equal((await f.request("/health")).status, 403);
  assert.equal(f.pages.length, 0);
});

test("health preserves bounded startup diagnostics through ready and failed launches", async (t) => {
  const ready = await fixture(t);
  assert.equal((await ready.request("/health")).body.startup.status, "idle");
  await ready.runtime.start();
  assert.deepEqual((await ready.request("/health")).body.startup, {
    stage: "publish",
    status: "ready",
    code: "unclassified",
  });
  const failed = await fixture(t, {
    launcher: {
      ensureBrowser: async () => {
        throw new Error("SYNTHETIC-private-proxy-error");
      },
    },
  });
  await assert.rejects(failed.runtime.start());
  const health = (await failed.request("/health")).body;
  assert.equal(health.startup.status, "failed");
  assert.equal(health.startup.code, "unclassified");
  assert.equal(health.browserConnected, false);
  assert.equal(JSON.stringify(health).includes("private-proxy"), false);
});

test("unconfigured login exposes no credential routes behind service authentication", async (t) => {
  const previous = process.env.FTRADE_LOGIN_PROFILE_JSON;
  delete process.env.FTRADE_LOGIN_PROFILE_JSON;
  t.after(() => {
    if (previous === undefined) delete process.env.FTRADE_LOGIN_PROFILE_JSON;
    else process.env.FTRADE_LOGIN_PROFILE_JSON = previous;
  });
  const f = await fixture(t, { registerIntegrations: true });
  for (const path of ["/ftrade/login-status", "/ftrade/login-fill", "/ftrade/login-submit"]) {
    assert.equal((await f.request(path, undefined, false)).status, 401);
    assert.equal((await f.request(path)).status, 404);
  }
});

test("closing a tab requires account scope and retires the handle", async (t) => {
  const f = await fixture(t);
  const id = await f.tab();
  assert.equal((await f.request(`/tabs/${id}`, { userId: runId }, true, "DELETE")).status, 403);
  assert.equal(f.pages[0].isClosed(), false);
  assert.equal((await f.request(`/tabs/${id}`, { userId: accountId }, true, "DELETE")).status, 200);
  assert.equal(f.pages[0].isClosed(), true);
  assert.equal(
    (await f.request(`/tabs/${id}/evaluate`, { userId: accountId, expression: "1" })).status,
    404,
  );
});
