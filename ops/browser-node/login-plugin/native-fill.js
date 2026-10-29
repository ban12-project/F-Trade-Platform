import pageProgram from "./page-program.cjs";
import { validateLoginProfile } from "./profile.js";

const inspectPage = new Function(`return (${pageProgram});`)();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
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
