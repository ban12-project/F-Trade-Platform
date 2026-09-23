import pageProgram from "./automatic-program.cjs";

const program = new Function(`return (${pageProgram});`)();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

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
      requestId = packet.requestId;
      if (operation === "observe")
        return await page.evaluate(program, { profile, operation, expiresAt });
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
        const current = await page.evaluate(program, { profile, operation: "observe", expiresAt });
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
      const outcome = await page.evaluate(program, {
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
