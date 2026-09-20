import { readFileSync } from "node:fs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_SOCKETS = 128;

/** Counts transport events only. Never reads frames, headers, or error arguments. */
export function createConnectionDiagnostics({ sessions, accountId, runId, leaseDeadline }) {
  if (!uuid.test(accountId ?? "") || !uuid.test(runId ?? ""))
    throw new Error("diagnostic_scope_invalid");
  const pages = new WeakMap();
  const validLease = () => {
    try {
      const deadline = leaseDeadline();
      return Number.isFinite(deadline) && deadline > Date.now() && deadline <= Date.now() + 95000;
    } catch {
      return false;
    }
  };
  function attach({ userId, page }) {
    if (userId !== accountId || pages.has(page) || !validLease()) return;
    const counts = {
      created: 0,
      closed: 0,
      errors: 0,
      sentFrames: 0,
      receivedFrames: 0,
      dropped: 0,
    };
    const cleanup = new Set();
    const increment = (key) => {
      if (validLease()) counts[key] = Math.min(Number.MAX_SAFE_INTEGER, counts[key] + 1);
    };
    const onSocket = (socket) => {
      if (!validLease()) return;
      // Inspect only the origin; never retain a URL or any query parameters.
      try {
        if (new URL(socket.url()).origin !== "wss://gateway.facebook.com") return;
      } catch {
        return;
      }
      if (counts.created >= MAX_SOCKETS) {
        increment("dropped");
        return;
      }
      increment("created");
      const sent = () => increment("sentFrames");
      const received = () => increment("receivedFrames");
      const error = () => increment("errors");
      const detach = () => {
        socket.off("framesent", sent);
        socket.off("framereceived", received);
        socket.off("socketerror", error);
        socket.off("close", closed);
        cleanup.delete(detach);
      };
      const closed = () => {
        increment("closed");
        detach();
      };
      socket.on("framesent", sent);
      socket.on("framereceived", received);
      socket.on("socketerror", error);
      socket.on("close", closed);
      cleanup.add(detach);
    };
    page.on("websocket", onSocket);
    page.once("close", () => {
      page.off("websocket", onSocket);
      for (const detach of cleanup) detach();
      pages.delete(page);
    });
    pages.set(page, counts);
  }
  function read(query) {
    if (
      !validLease() ||
      !query ||
      Object.keys(query).sort().join(",") !== "runId,tabId,userId" ||
      query.userId !== accountId ||
      query.runId !== runId ||
      typeof query.tabId !== "string" ||
      !query.tabId ||
      query.tabId.length > 200
    )
      return null;
    const page = sessions.get(accountId)?.tabGroups.get(runId)?.get(query.tabId)?.page;
    if (!page || page.isClosed() || !pages.has(page)) return null;
    return { version: 1, ...pages.get(page) };
  }
  return { attach, read };
}

export function register(app, ctx, config = {}) {
  if (config.enabled !== true || process.env.FTRADE_DIAGNOSTIC_KIND !== "interactive") return;
  if (!ctx.config?.accessKey) throw new Error("diagnostic_access_key_required");
  const diagnostics = createConnectionDiagnostics({
    sessions: ctx.sessions,
    accountId: process.env.FTRADE_DIAGNOSTIC_ACCOUNT,
    runId: process.env.FTRADE_DIAGNOSTIC_RUN,
    leaseDeadline: () => Number(readFileSync("/tmp/ftrade-lease", "utf8")),
  });
  // Attach before first navigation; the upstream tab:created hook runs after goto.
  ctx.events.on("session:created", ({ userId, context }) => {
    context.on("page", (page) => diagnostics.attach({ userId, page }));
  });
  ctx.events.on("tab:created", diagnostics.attach);
  app.get("/ftrade/connection-diagnostics", ctx.auth(), (req, res) => {
    res.set("Cache-Control", "no-store");
    const result = diagnostics.read(req.query);
    if (!result) return res.status(403).json({ error: "diagnostic_unavailable" });
    res.json(result);
  });
}
