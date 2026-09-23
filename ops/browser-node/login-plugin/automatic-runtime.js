import pageProgram from "./automatic-program.cjs";

const program = new Function(`return (${pageProgram});`)();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

async function visibleFacebookCaptcha(page) {
  const frames = page.frames();
  if (frames.length > 32) throw new Error("frame_limit");
  for (const frame of frames) {
    const url = new URL(frame.url());
    if (url.origin !== "https://www.fbsbx.com" || url.pathname !== "/captcha/recaptcha/iframe/")
      continue;
    let current = frame;
    let visible = true;
    for (let depth = 0; current.parentFrame(); depth++) {
      if (depth >= 4) throw new Error("frame_depth");
      const element = await current.frameElement();
      try {
        if (!(await element.isVisible())) {
          visible = false;
          break;
        }
      } finally {
        await element.dispose();
      }
      current = current.parentFrame();
    }
    if (visible) return true;
  }
  return false;
}

export function createAutomaticLoginRuntime({
  sessions,
  accountId,
  runId,
  profile,
  leaseDeadline,
}) {
  const submitted = new Set();
  let requestId;
  return async (operation, packet) => {
    try {
      if (
        !packet ||
        packet.userId !== accountId ||
        packet.runId !== runId ||
        !uuid.test(packet.requestId ?? "") ||
        typeof packet.tabId !== "string" ||
        packet.tabId.length > 200 ||
        (requestId && requestId !== packet.requestId) ||
        !Number.isFinite(packet.expiresAt) ||
        packet.expiresAt > Date.now() + 90000
      )
        return { outcome: "refused" };
      const expiresAt = Math.min(packet.expiresAt, leaseDeadline(), Date.parse(profile.expiresAt));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { outcome: "refused" };
      const page = sessions.get(accountId)?.tabGroups.get(runId)?.get(packet.tabId)?.page;
      if (!page || page.isClosed()) return { outcome: "refused" };
      const evaluate = async (args) => {
        let sessionIdentity;
        if (profile.automation.identity.attribute === "facebook-current-user") {
          const cookies = await page.context().cookies("https://www.facebook.com/");
          const users = cookies.filter((cookie) => cookie.name === "c_user");
          const actors = cookies.filter((cookie) => cookie.name === "i_user");
          // Pass only comparisons to the page; never expose session cookie values.
          sessionIdentity = {
            verified:
              users.length === 1 &&
              users[0].value === profile.automation.accountRef &&
              actors.every((cookie) => cookie.value === profile.automation.accountRef),
            mismatch:
              users.some((cookie) => cookie.value !== profile.automation.accountRef) ||
              actors.some((cookie) => cookie.value !== profile.automation.accountRef) ||
              users.length > 1,
          };
        }
        const captchaVisible =
          profile.automation.totp.mode === "facebook-authenticator" &&
          new URL(page.url()).pathname === "/two_step_verification/authentication/" &&
          (await visibleFacebookCaptcha(page));
        return page.evaluate(program, { ...args, sessionIdentity, captchaVisible });
      };
      requestId = packet.requestId;
      if (operation === "observe") {
        // A submitted form can destroy the previous document before observation starts.
        // Retry reads only; never replay a credential submission after navigation.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await evaluate({ profile, operation, expiresAt });
          } catch (error) {
            if (
              attempt === 2 ||
              Date.now() >= expiresAt ||
              !/Execution context was destroyed|Cannot find context with specified id/i.test(
                String(error?.message ?? ""),
              )
            )
              throw error;
            await page.waitForLoadState("domcontentloaded", {
              timeout: Math.min(5000, Math.max(1, expiresAt - Date.now())),
            });
          }
        }
      }
      const phase = packet.phase;
      if (!["password", "totp", "messenger", "pin"].includes(phase) || submitted.has(phase))
        return { outcome: "refused" };
      if (
        phase === "password" &&
        (typeof packet.values?.username !== "string" ||
          !packet.values.username ||
          packet.values.username.length > 320 ||
          typeof packet.values?.password !== "string" ||
          !packet.values.password ||
          packet.values.password.length > 4096)
      )
        return { outcome: "refused" };
      if (
        ["totp", "pin"].includes(phase) &&
        (!/^[0-9]{6}$/.test(packet.values?.code ?? "") ||
          !Number.isFinite(packet.values.expiresAt) ||
          packet.values.expiresAt > expiresAt)
      )
        return { outcome: "refused" };
      submitted.add(phase);
      if (phase === "messenger") {
        const current = await evaluate({ profile, operation: "observe", expiresAt });
        if (
          current.state !== "messenger" ||
          current.identityVerified !== true ||
          Date.now() >= expiresAt
        )
          return { outcome: "refused" };
        await page.goto(profile.automation.ready.url, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(15000, expiresAt - Date.now()),
        });
        return { outcome: "submitted" };
      }
      const outcome = await evaluate({
        profile,
        operation: "submit",
        phase,
        values: packet.values,
        expiresAt,
      });
      return { outcome: ["submitted", "refused"].includes(outcome) ? outcome : "unknown" };
    } catch {
      return { outcome: "unknown" };
    } finally {
      if (packet && typeof packet === "object") delete packet.values;
    }
  };
}
