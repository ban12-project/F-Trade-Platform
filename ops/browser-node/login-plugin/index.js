import { readFileSync } from "node:fs";
import { createAutomaticLoginRuntime } from "./automatic-runtime.js";
import { createLoginFill } from "./native-fill.js";
import { validateLoginProfile } from "./profile.js";

export { createLoginFill, validateLoginProfile };

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function register(app, ctx, config = {}) {
  // Loading the plugin does not expose an endpoint without explicit per-run configuration.
  if (config.enabled !== true || !process.env.FTRADE_LOGIN_PROFILE_JSON) return;
  if (!ctx.config?.accessKey) throw new Error("login_access_key_required");
  const profile = validateLoginProfile(JSON.parse(process.env.FTRADE_LOGIN_PROFILE_JSON));
  if (profile.version === 2) {
    const accountId = process.env.FTRADE_ACCOUNT_ID,
      runId = process.env.FTRADE_RUN_ID;
    if (
      !uuid.test(accountId ?? "") ||
      !uuid.test(runId ?? "") ||
      process.env.FTRADE_RUN_KIND !== "interactive" ||
      profile.automation.accountRef !== process.env.FTRADE_ACCOUNT_REF
    )
      throw new Error("login_runtime_scope_invalid");
    const execute = createAutomaticLoginRuntime({
      sessions: ctx.sessions,
      accountId,
      runId,
      profile,
      leaseDeadline: () => Number(readFileSync("/tmp/ftrade-lease", "utf8")),
    });
    app.get("/ftrade/login-status", ctx.auth(), (_req, res) => {
      res.set("Cache-Control", "no-store");
      try {
        validateLoginProfile(profile);
        const deadline = Number(readFileSync("/tmp/ftrade-lease", "utf8"));
        if (!Number.isFinite(deadline) || deadline <= Date.now())
          throw new Error("login_lease_expired");
        res.json({
          version: 2,
          runId,
          accountId,
          reviewRef: profile.reviewRef,
          expiresAt: Date.parse(profile.expiresAt),
        });
      } catch {
        res.status(403).json({ error: "login_unavailable" });
      }
    });
    for (const operation of ["observe", "submit"])
      app.post(`/ftrade/login-${operation}`, ctx.auth(), async (req, res) => {
        res.set("Cache-Control", "no-store");
        res.json(await execute(operation, req.body));
      });
    return;
  }
  const fill = createLoginFill({
    sessions: ctx.sessions,
    accountId: process.env.FTRADE_ACCOUNT_ID,
    runId: process.env.FTRADE_RUN_ID,
    kind: process.env.FTRADE_RUN_KIND,
    profile,
    leaseDeadline: () => Number(readFileSync("/tmp/ftrade-lease", "utf8")),
  });
  app.get("/ftrade/login-status", ctx.auth(), (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      validateLoginProfile(profile);
      const deadline = Number(readFileSync("/tmp/ftrade-lease", "utf8"));
      if (!Number.isFinite(deadline) || deadline <= Date.now())
        throw new Error("login_lease_expired");
      res.json({
        version: 1,
        runId: process.env.FTRADE_RUN_ID,
        accountId: process.env.FTRADE_ACCOUNT_ID,
        reviewRef: profile.reviewRef,
        expiresAt: Date.parse(profile.expiresAt),
      });
    } catch {
      res.status(403).json({ error: "login_unavailable" });
    }
  });
  app.post("/ftrade/login-fill", ctx.auth(), async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await fill(req.body));
  });
}
