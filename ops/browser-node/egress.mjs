import { isIP } from "node:net";

// This is a browser navigation in the account's own session, never a host fetch.
export const EGRESS_URL = "https://api.ipify.org/";
function canonicalIp(value) {
  if (typeof value !== "string" || !isIP(value)) throw new Error("egress_ip_invalid");
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value;
}
export function readEgressSnapshot(value, expectedIp) {
  const expected = canonicalIp(expectedIp);
  if (
    !value ||
    value.url !== EGRESS_URL ||
    value.truncated ||
    value.hasMore ||
    typeof value.snapshot !== "string" ||
    value.snapshot.length > 1024
  )
    throw new Error("egress_observation_invalid");
  // Plain-text pages have one generic/text node in the pinned Camofox ARIA
  // snapshot. Reject navigation, challenges, multiple addresses and extra text.
  const match = /^- (?:generic|text): (?:"([0-9a-fA-F:.]+)"|([0-9a-fA-F:.]+))$/.exec(
    value.snapshot.trim(),
  );
  if (!match) throw new Error("egress_observation_invalid");
  if (canonicalIp(match[1] ?? match[2]) !== expected) throw new Error("egress_ip_mismatch");
}
async function boundedJson(response) {
  if (!response.body) throw new Error("egress_response_missing");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16_384) {
        await reader.cancel();
        throw new Error("egress_response_limit");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}
export async function verifyBrowserEgress(browserRequest, run, tabId) {
  canonicalIp(run.expectedEgressIp);
  if (typeof tabId !== "string" || !tabId || tabId.length > 200)
    throw new Error("egress_tab_invalid");
  const path = `/tabs/${encodeURIComponent(tabId)}`;
  const refreshed = await browserRequest(`${path}/navigate`, {
    userId: run.accountId,
    url: EGRESS_URL,
  });
  const navigation = await boundedJson(refreshed);
  if (navigation.url !== EGRESS_URL) throw new Error("egress_navigation_invalid");
  const response = await browserRequest(
    `${path}/snapshot?userId=${encodeURIComponent(run.accountId)}&format=json&includeScreenshot=false`,
  );
  readEgressSnapshot(await boundedJson(response), run.expectedEgressIp);
}
export async function openEgressCheckedSession(browserRequest, run) {
  // Validate configuration before creating any tab, including the neutral probe.
  canonicalIp(run.expectedEgressIp);
  const opened = await browserRequest("/tabs", {
    userId: run.accountId,
    sessionKey: run.id,
    url: EGRESS_URL,
    trace: false,
  });
  const probe = await boundedJson(opened);
  if (probe.url !== EGRESS_URL) throw new Error("egress_navigation_invalid");
  await verifyBrowserEgress(browserRequest, run, probe.tabId);
  if (run.kind === "interactive") {
    const login = await browserRequest("/tabs", {
      userId: run.accountId,
      sessionKey: run.id,
      url: "https://www.facebook.com/",
      trace: false,
    });
    await login.body?.cancel();
  }
  return probe.tabId;
}
