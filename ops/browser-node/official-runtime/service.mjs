import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import express from "express";
import { register as registerDiagnostics } from "../diagnostics-plugin/index.js";
import { register as registerLogin } from "../login-plugin/index.js";
import { createStartupDiagnostics } from "../startup-diagnostics.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const failure = (code, status = 400) =>
  Object.assign(new Error(code), { publicCode: code, status });
const text = (value, max, allowEmpty = false) => {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()))
    throw failure("invalid_input");
  return value;
};
function navigationUrl(value) {
  let url;
  try {
    url = new URL(text(value, 8192));
  } catch {
    throw failure("navigation_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["www.facebook.com", "web.facebook.com", "www.messenger.com", "api.ipify.org"].includes(
      url.hostname,
    )
  )
    throw failure("navigation_url_invalid");
  return url.href;
}

/** A local, per-run API. The Agent still owns task authorization and submission.
 * Never put request bodies, raw browser errors or cookies in shared logs.
 */
export function createRuntimeService({
  launcher,
  startupDiagnostics = createStartupDiagnostics(),
  accountId,
  runId,
  accessKey,
  leaseDeadline,
  viewer,
  validateUrl = navigationUrl,
  registerIntegrations = true,
  operationTimeoutMs = 30000,
  onFatal = () => {},
}) {
  if (
    !uuid.test(accountId) ||
    !uuid.test(runId) ||
    typeof accessKey !== "string" ||
    accessKey.length < 24
  )
    throw failure("runtime_scope_invalid");
  if (!Number.isFinite(operationTimeoutMs) || operationTimeoutMs <= 0 || operationTimeoutMs > 60000)
    throw failure("runtime_timeout_invalid");
  const app = express();
  app.disable("x-powered-by");
  const key = createHash("sha256").update(accessKey).digest();
  const events = new EventEmitter();
  const tabs = new Map(),
    pageIds = new WeakMap();
  const sessions = new Map([[accountId, { tabGroups: new Map([[runId, tabs]]) }]]);
  let context,
    browser,
    starting,
    closed = false,
    busy = false,
    poisoned = false;
  const active = () => {
    const deadline = leaseDeadline();
    if (
      closed ||
      poisoned ||
      !Number.isFinite(deadline) ||
      deadline <= Date.now() ||
      deadline > Date.now() + 95000
    )
      throw failure("runtime_unavailable", 403);
  };
  const auth = () => (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const candidate = req.get("authorization");
    if (
      typeof candidate !== "string" ||
      !candidate.startsWith("Bearer ") ||
      candidate.length > 1024 ||
      !timingSafeEqual(key, createHash("sha256").update(candidate.slice(7)).digest())
    )
      return res.status(401).json({ error: "unauthorized", retryable: false });
    try {
      active();
      next();
    } catch (error) {
      next(error);
    }
  };
  app.use(auth());
  app.use(express.json({ limit: "2mb", strict: true }));
  const scope = (userId) => {
    active();
    if (userId !== accountId) throw failure("account_mismatch", 403);
    launcher.assertAccount(userId);
  };
  function track(page) {
    if (pageIds.has(page)) return pageIds.get(page);
    if (tabs.size >= 4) {
      void page.close().catch(() => {});
      throw failure("tab_limit", 409);
    }
    const tabId = randomUUID();
    tabs.set(tabId, { page });
    pageIds.set(page, tabId);
    page.once("close", () => tabs.delete(tabId));
    events.emit("tab:created", { userId: accountId, page, tabId });
    return tabId;
  }
  async function start() {
    active();
    if (!starting) {
      if (startupDiagnostics.read().status === "idle") startupDiagnostics.begin();
      starting = (async () => {
        browser = await launcher.ensureBrowser(60000);
        active();
        context = await launcher.contextFor(accountId);
        context.setDefaultTimeout(10000);
        context.setDefaultNavigationTimeout(25000);
        events.emit("session:created", { userId: accountId, context });
        context.on("page", (page) => {
          try {
            track(page);
          } catch {
            poisoned = true;
            onFatal();
          }
        });
        // Keep restored pages available to the human, but do not transfer their
        // ownership to a new automation task. Only newly created pages get IDs.
        if (context.pages().length > 4) throw failure("restored_tab_limit", 409);
        startupDiagnostics.stage("publish");
        startupDiagnostics.ready();
        return context;
      })().catch((error) => {
        startupDiagnostics.fail(error);
        throw error;
      });
    }
    return starting;
  }
  async function operation(work) {
    active();
    if (busy) throw failure("runtime_busy", 409);
    busy = true;
    let timer;
    const pending = Promise.resolve().then(work);
    // Ownership is released only when the actual work settles, not when an
    // observer times out. A timed-out side effect must never be retried here.
    pending
      .finally(() => {
        busy = false;
      })
      .catch(() => {});
    try {
      const result = await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            poisoned = true;
            reject(failure("operation_unknown", 504));
            onFatal();
          }, operationTimeoutMs);
        }),
      ]);
      active();
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
  const pageFor = (id, userId) => {
    scope(userId);
    const page = tabs.get(id)?.page;
    if (!page || page.isClosed()) throw failure("tab_unavailable", 404);
    return page;
  };
  const route = (work) => async (req, res) => {
    const result = await operation(() => work(req));
    const body = JSON.stringify(result);
    if (body.length > 4 * 1024 * 1024) throw failure("response_limit", 413);
    res.type("json").send(body);
  };
  app.get("/health", (_req, res) =>
    res.json({
      ok: true,
      engine: "camoufox",
      startup: startupDiagnostics.read(),
      activeTabs: tabs.size,
      browserConnected: !!browser?.isConnected(),
      browserRunning: !!browser?.isConnected() && !!context,
    }),
  );
  app.get("/vnc/status", async (_req, res) => res.json({ running: await viewer.status() }));
  app.post(
    "/tabs",
    route(async (req) => {
      scope(req.body?.userId);
      if (
        req.body.sessionKey !== runId ||
        (req.body.trace !== undefined && req.body.trace !== false)
      )
        throw failure("run_mismatch", 403);
      const url = validateUrl(req.body.url);
      await start();
      active();
      if (tabs.size >= 4) throw failure("tab_limit", 409);
      const page = await context.newPage();
      const tabId = track(page);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      return { ok: true, tabId, url: page.url() };
    }),
  );
  app.post(
    "/tabs/:tabId/navigate",
    route(async (req) => {
      const page = pageFor(req.params.tabId, req.body?.userId);
      const url = validateUrl(req.body.url);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return { ok: true, tabId: req.params.tabId, url: page.url() };
    }),
  );
  app.get(
    "/tabs/:tabId/snapshot",
    route(async (req) => {
      const page = pageFor(req.params.tabId, req.query.userId);
      if (req.query.format !== "json" || req.query.includeScreenshot !== "false")
        throw failure("snapshot_options_invalid");
      const snapshot = await page.locator("body").ariaSnapshot();
      if (snapshot.length > 1024 * 1024) throw failure("response_limit", 413);
      return { ok: true, url: page.url(), snapshot, truncated: false, hasMore: false };
    }),
  );
  app.post(
    "/tabs/:tabId/evaluate",
    route(async (req) => {
      const page = pageFor(req.params.tabId, req.body?.userId);
      const expression = text(req.body.expression, 1024 * 1024);
      try {
        return { ok: true, result: await page.evaluate(expression) };
      } catch (error) {
        if (
          /Execution context was destroyed|Cannot find context with specified id|navigation.*destroyed/i.test(
            String(error.message),
          )
        )
          throw failure("navigation_race", 409);
        throw error;
      }
    }),
  );
  app.post(
    "/tabs/:tabId/scroll",
    route(async (req) => {
      const page = pageFor(req.params.tabId, req.body?.userId);
      const { direction, amount } = req.body;
      if (
        !["up", "down"].includes(direction) ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > 10000
      )
        throw failure("scroll_invalid");
      await page.mouse.wheel(0, direction === "up" ? -amount : amount);
      return { ok: true };
    }),
  );
  app.post(
    "/act",
    route(async (req) => {
      const page = pageFor(req.body?.targetId, req.body?.userId);
      if (req.body.kind !== "hover") throw failure("action_unsupported");
      try {
        await page.locator(text(req.body.selector, 2000)).hover({ timeout: 5000 });
      } catch (error) {
        if (error.name === "TimeoutError") throw failure("element_not_actionable", 422);
        throw error;
      }
      return { ok: true };
    }),
  );
  app.post(
    "/tabs/:tabId/type",
    route(async (req) => {
      const page = pageFor(req.params.tabId, req.body?.userId);
      const { mode, submit, pressEnter } = req.body;
      if (!["fill", "keyboard"].includes(mode) || submit !== false || pressEnter !== false)
        throw failure("type_options_invalid");
      const locator = page.locator(text(req.body.selector, 2000));
      const value = text(req.body.text, 100000, true);
      if (mode === "fill") await locator.fill(value);
      else {
        await locator.focus();
        await page.keyboard.type(value, { delay: 0 });
      }
      return { ok: true };
    }),
  );
  app.post(
    "/tabs/:tabId/upload",
    route(async (req) => {
      const page = pageFor(req.params.tabId, req.body?.userId);
      const path = text(req.body.path, 200);
      const match = /^\/tmp\/ftrade-uploads\/([a-f0-9]{64})\.(png|jpg|mp4)$/.exec(path);
      const selector = text(req.body.inputSelector, 500);
      if (!match || selector.includes(",")) throw failure("upload_invalid");
      const input = page.locator(selector);
      if (
        (await input.count()) !== 1 ||
        !(await input.evaluate((el) => el.tagName === "INPUT" && el.type === "file"))
      )
        throw failure("upload_input_invalid", 422);
      const file = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let buffer;
      try {
        const stat = await file.stat();
        if (
          !stat.isFile() ||
          stat.size <= 0 ||
          stat.size > 256 * 1024 * 1024 ||
          stat.uid !== process.getuid()
        )
          throw failure("upload_invalid");
        buffer = await file.readFile();
      } finally {
        await file.close();
      }
      if (createHash("sha256").update(buffer).digest("hex") !== match[1])
        throw failure("upload_invalid");
      await input.setInputFiles({
        name: `${match[1]}.${match[2]}`,
        mimeType: { png: "image/png", jpg: "image/jpeg", mp4: "video/mp4" }[match[2]],
        buffer,
      });
      return { ok: true, attached: [path] };
    }),
  );
  app.get("/sessions/:userId/storage_state", (req, res) => {
    scope(req.params.userId);
    // The Agent only awaits this endpoint on shutdown. Native Firefox storage
    // is flushed by context.close(); no exported cookies or keys are returned.
    res.json({ ok: true, persistence: "native" });
  });
  if (registerIntegrations) {
    const ctx = { sessions, events, config: { accessKey }, auth };
    registerLogin(app, ctx, { enabled: true });
    registerDiagnostics(app, ctx, { enabled: true });
  }
  app.use((_req, res) => res.status(404).json({ error: "not_found", retryable: false }));
  app.use((error, _req, res, _next) => {
    const status = error.publicCode
      ? error.status
      : error.type === "entity.too.large"
        ? 413
        : error.type === "entity.parse.failed"
          ? 400
          : 500;
    const code = error.publicCode ?? (status === 500 ? "operation_failed" : "invalid_request");
    res.status(status).json({ error: code, code, retryable: false });
  });
  return {
    app,
    start,
    async close() {
      closed = true;
      // Do not start another browser or create/reset a profile during teardown.
      await starting?.catch(() => {});
      if (context) await context.close();
      else await browser?.close();
    },
  };
}
