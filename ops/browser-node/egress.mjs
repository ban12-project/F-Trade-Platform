import { isIP } from "node:net";
import { describeBrowserLaunchFailure } from "./launch-diagnostics.mjs";

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
export async function waitForBrowserReady(browserRequest, { assertActive, sleep }) {
  for (let attempt = 0; attempt < 60; attempt++) {
    assertActive();
    let status;
    try {
      const response = await browserRequest("/health", undefined, 2000);
      if (response.ok) status = await boundedJson(response);
      else await response.body?.cancel();
    } catch {
      // The HTTP listener may start before Firefox's prewarm finishes.
    }
    assertActive();
    if (
      status?.ok === true &&
      status.engine === "camoufox" &&
      status.browserConnected === true &&
      status.browserRunning === true
    )
      return;
    if (attempt < 59) await sleep(1000);
  }
  throw new Error("browser_start_timeout");
}
// Heartbeat and task authorization share a probe tab and the same run object.
// Queue the entire observation, not just navigation. Each caller needs a fresh
// result; a shared success could authorize work using an older observation.
const pendingChecks = new WeakMap();
export function verifyBrowserEgress(browserRequest, run, tabId) {
  const previous = pendingChecks.get(run) ?? Promise.resolve();
  // A failed check also rejects callers already queued behind it. Do not turn
  // transport errors or IP mismatches into implicit retry attempts.
  const current = previous.then(() => observeBrowserEgress(browserRequest, run, tabId));
  pendingChecks.set(run, current);
  const clear = () => {
    if (pendingChecks.get(run) === current) pendingChecks.delete(run);
  };
  void current.then(clear, clear);
  return current;
}
async function observeBrowserEgress(browserRequest, run, tabId) {
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
export async function openEgressCheckedSession(browserRequest, run, onInteractiveTab) {
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
    if (onInteractiveTab) {
      const page = await boundedJson(login);
      if (typeof page.tabId !== "string" || !page.tabId || page.tabId.length > 200)
        throw new Error("interactive_tab_invalid");
      onInteractiveTab(page.tabId);
    } else await login.body?.cancel();
  }
  return probe.tabId;
}

/** Diagnostics distinguish failed observation from an actual observed IP mismatch. */
export function describeEgressFailure(error) {
  const reasons = new Set([
    "egress_ip_invalid",
    "egress_tab_invalid",
    "egress_response_missing",
    "egress_response_limit",
    "egress_navigation_invalid",
    "egress_observation_invalid",
    "egress_ip_mismatch",
  ]);
  const detail = describeBrowserLaunchFailure("egress", error);
  return {
    event: "browser_egress_failed",
    reason: reasons.has(error?.message) ? error.message : "egress_observation_unavailable",
    request: detail.request,
    code: detail.code,
    httpStatus: detail.httpStatus,
  };
}
