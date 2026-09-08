import { readFileSync } from "node:fs";
import pageProgram from "./page-program.cjs";

const fillPage = new Function(`return (${pageProgram});`)();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function validateLoginProfile(profile, now = Date.now()) {
  if (profile?.version !== 1 || !/^evidence-[a-z0-9_-]{3,120}$/i.test(profile.reviewRef ?? ""))
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
      const outcome = await page.evaluate(fillPage, {
        profile,
        username: packet.username,
        password: packet.password,
        expiresAt: Math.min(deadline, packet.expiresAt, Date.parse(profile.expiresAt)),
      });
      return { outcome: ["filled", "refused"].includes(outcome) ? outcome : "unknown" };
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
  // Deliberately disabled until the platform owner-session/one-use release is wired.
  if (config.enabled !== true) return;
  if (!ctx.config?.accessKey) throw new Error("login_access_key_required");
  const fill = createLoginFill({
    sessions: ctx.sessions,
    accountId: process.env.FTRADE_ACCOUNT_ID,
    runId: process.env.FTRADE_RUN_ID,
    kind: process.env.FTRADE_RUN_KIND,
    profile: config.profile,
    leaseDeadline: () => Number(readFileSync("/tmp/ftrade-lease", "utf8")),
  });
  app.post("/ftrade/login-fill", ctx.auth(), async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await fill(req.body));
  });
}
