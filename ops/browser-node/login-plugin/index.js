import { readFileSync } from "node:fs";
import { validateAutomaticProfile } from "./automatic-profile.js";
import { createAutomaticLoginRuntime } from "./automatic-runtime.js";
import pageProgram from "./page-program.cjs";

const inspectPage = new Function(`return (${pageProgram});`)();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function validateLoginProfile(profile, now = Date.now()) {
  if (profile?.version === 2) {
    if (Object.hasOwn(profile, "formActionMode")) throw new Error("login_profile_invalid");
    const { automation, ...legacy } = profile;
    validateLoginProfile({ ...legacy, version: 1 }, now);
    return { ...structuredClone(profile), automation: validateAutomaticProfile(automation) };
  }
  if (
    !profile ||
    Object.keys(profile).sort().join(",") !==
      (profile.formActionMode === "facebook-root-implicit"
        ? "expiresAt,form,formActionMode,password,reviewRef,reviewedAt,url,username,version"
        : "expiresAt,form,password,reviewRef,reviewedAt,url,username,version") ||
    profile.version !== 1 ||
    !/^evidence-[a-z0-9_-]{3,120}$/i.test(profile.reviewRef ?? "")
  )
    throw new Error("login_profile_invalid");
  const reviewed = Date.parse(profile.reviewedAt),
    expires = Date.parse(profile.expiresAt);
  if (
    !Number.isFinite(reviewed) ||
    reviewed > now ||
    !Number.isFinite(expires) ||
    expires <= now ||
    expires <= reviewed ||
    expires - reviewed > 30 * 86400000
  )
    throw new Error("login_profile_invalid");
  const url = new URL(profile.url);
  if (
    url.origin !== "https://www.facebook.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/login", "/login/", "/login.php"].includes(url.pathname) ||
    url.href !== profile.url
  )
    throw new Error("login_profile_invalid");
  for (const key of ["form", "username", "password"])
    if (
      typeof profile[key] !== "string" ||
      !profile[key].trim() ||
      profile[key].length > 500 ||
      profile[key].includes(",")
    )
      throw new Error("login_profile_invalid");
  if (
    profile.formActionMode === "facebook-root-implicit" &&
    (profile.url !== "https://www.facebook.com/" ||
      profile.form !== "#login_form" ||
      profile.username !== '#login_form input[name="email"]' ||
      profile.password !== '#login_form input[name="pass"]')
  )
    throw new Error("login_profile_invalid");
  return structuredClone(profile);
}

/** One fill attempt per isolated interactive runtime. Never invokes Camofox type/evaluate routes. */
export function createLoginFill({
  sessions,
  accountId,
  runId,
  kind,
  profile: input,
  leaseDeadline,
}) {
  if (!uuid.test(accountId ?? "") || !uuid.test(runId ?? "") || kind !== "interactive")
    throw new Error("login_runtime_scope_invalid");
  const profile = validateLoginProfile(input);
  let used = false;
  return async (packet) => {
    try {
      if (
        !packet ||
        Object.keys(packet).sort().join(",") !==
          "expiresAt,password,requestId,runId,tabId,userId,username" ||
        !uuid.test(packet.requestId ?? "") ||
        packet.runId !== runId ||
        packet.userId !== accountId ||
        typeof packet.tabId !== "string" ||
        !packet.tabId ||
        packet.tabId.length > 200 ||
        typeof packet.username !== "string" ||
        !packet.username ||
        packet.username.length > 320 ||
        typeof packet.password !== "string" ||
        !packet.password ||
        packet.password.length > 4096
      )
        return { outcome: "refused" };
      validateLoginProfile(profile);
      const now = Date.now(),
        deadline = leaseDeadline();
      if (
        used ||
        !Number.isFinite(deadline) ||
        deadline <= now ||
        deadline > now + 95000 ||
        !Number.isFinite(packet.expiresAt) ||
        packet.expiresAt <= now ||
        packet.expiresAt > now + 30000
      )
        return { outcome: "refused" };
      // A tab from another account, run, or popup group cannot receive this credential.
      const page = sessions.get(accountId)?.tabGroups.get(runId)?.get(packet.tabId)?.page;
      if (!page || page.isClosed()) return { outcome: "refused" };
      used = true; // Consume before calling the browser; even a lost response cannot retry.
      await page.bringToFront();
      const expiresAt = Math.min(deadline, packet.expiresAt, Date.parse(profile.expiresAt));
      const handles = [];
      try {
        const review = async (phase) => {
          const currentLease = leaseDeadline();
          if (
            !Number.isFinite(currentLease) ||
            currentLease <= Date.now() ||
            Date.now() >= expiresAt
          )
            throw new Error("login_expired");
          const handle = await page.evaluateHandle(inspectPage, {
            profile,
            username: packet.username,
            ...(phase === "filled" ? { password: packet.password } : {}),
            phase,
            expiresAt: Math.min(expiresAt, currentLease),
          });
          handles.push(handle);
          return handle;
        };
        const original = await review("initial");
        if (!(await original.evaluate((nodes) => Boolean(nodes)))) return { outcome: "refused" };
        const userHandle = await original.getProperty("user"),
          secretHandle = await original.getProperty("secret");
        handles.push(userHandle, secretHandle);
        const user = userHandle.asElement(),
          secret = secretHandle.asElement();
        if (!user || !secret) return { outcome: "refused" };
        const timeout = () => {
          const remaining = Math.min(expiresAt, leaseDeadline()) - Date.now();
          if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("login_expired");
          return Math.min(5000, remaining);
        };
        const unchanged = async (phase) => {
          const current = await review(phase);
          return current.evaluate(
            (nodes, prior) =>
              Boolean(nodes) &&
              nodes.form === prior.form &&
              nodes.user === prior.user &&
              nodes.secret === prior.secret,
            original,
          );
        };
        // Stable handles cannot retarget a replacement document or control.
        // Native input emits browser input events; v1 never clicks or submits.
        await user.fill(packet.username, { timeout: timeout() });
        if (!(await unchanged("user-filled"))) return { outcome: "unknown" };
        await secret.fill(packet.password, { timeout: timeout() });
        return { outcome: (await unchanged("filled")) ? "filled" : "unknown" };
      } finally {
        await Promise.allSettled(handles.map((handle) => handle.dispose()));
      }
    } catch {
      // Playwright errors may include input values. Never forward or log the exception.
      return { outcome: "unknown" };
    } finally {
      if (packet && typeof packet === "object") {
        delete packet.username;
        delete packet.password;
      }
    }
  };
}

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
