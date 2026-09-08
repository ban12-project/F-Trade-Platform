import { setTimeout as delay } from "node:timers/promises";
import pagePrograms from "./page-programs.cjs";

const pageProgram = pagePrograms.inbox;
const keys = [
  "identity",
  "inboxReady",
  "conversationLink",
  "emptyInbox",
  "threadReady",
  "threadIdentity",
  "message",
  "inbound",
  "outbound",
  "body",
  "time",
  "emptyThread",
  "challenge",
  "loading",
  "moreThreads",
  "moreMessages",
];
export function validateInboxProfile(value, now = Date.now()) {
  if (
    value?.version !== 1 ||
    ![value.channelRef, value.accountRef].every(
      (v) => typeof v === "string" && v.trim() && v.length <= 160,
    ) ||
    !/^evidence-[a-z0-9_-]{3,120}$/i.test(value.reviewRef ?? "")
  )
    throw new Error("inbox_profile_invalid");
  const reviewed = Date.parse(value.reviewedAt),
    expires = Date.parse(value.expiresAt);
  if (
    !Number.isFinite(reviewed) ||
    reviewed > now ||
    !Number.isFinite(expires) ||
    expires <= now ||
    expires <= reviewed ||
    expires - reviewed > 30 * 86400000
  )
    throw new Error("inbox_profile_expired");
  for (const key of ["url", "identityHref"]) {
    const url = new URL(value[key]);
    if (
      url.origin !== "https://www.facebook.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname === "/"
    )
      throw new Error("inbox_profile_origin_invalid");
    if (key === "url" && !url.pathname.startsWith("/messages"))
      throw new Error("inbox_profile_origin_invalid");
  }
  if (
    keys.some(
      (key) =>
        typeof value.selectors?.[key] !== "string" ||
        !value.selectors[key].trim() ||
        value.selectors[key].length > 500 ||
        value.selectors[key].includes(","),
    )
  )
    throw new Error("inbox_profile_selectors_invalid");
  for (const key of ["loginRequired", "twoFactorRequired"]) {
    const selector = value.selectors[key];
    if (
      selector !== undefined &&
      (typeof selector !== "string" ||
        !selector.trim() ||
        selector.length > 500 ||
        selector.includes(","))
    )
      throw new Error("inbox_profile_selectors_invalid");
  }
  for (const key of ["conversationId", "messageId"])
    if (!/^data-[a-z][a-z0-9-]{1,60}$/.test(value.attributes?.[key] ?? ""))
      throw new Error("inbox_profile_attributes_invalid");
  return structuredClone(value);
}

// Read-only page code. Never clicks a reply control, types, sends or scrolls.

async function boundedJson(response) {
  if (!response.ok || !response.body) throw new Error("inbox_browser_response_invalid");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1000000) throw new Error("inbox_response_limit");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export function createFacebookInbox(input, browserRequest) {
  const profile = validateInboxProfile(input);
  return async ({ run, signal, reportInbound }) => {
    const scanStartedAt = new Date().toISOString();
    const active = () => {
      validateInboxProfile(profile);
      if (signal.aborted) throw new Error("inbox_cancelled");
    };
    let tabId;
    const read = async (url, mode, conversationRef) => {
      active();
      const tab = await boundedJson(
        await browserRequest(tabId ? `/tabs/${encodeURIComponent(tabId)}/navigate` : "/tabs", {
          userId: run.accountId,
          sessionKey: run.id,
          url,
          trace: false,
        }),
      );
      if (!tab.tabId || typeof tab.tabId !== "string" || tab.tabId.length > 200 || tab.url !== url)
        throw new Error("inbox_navigation_invalid");
      if (tabId && (tab.ok !== true || tab.tabId !== tabId))
        throw new Error("inbox_navigation_invalid");
      tabId = tab.tabId;
      active();
      for (let attempt = 0; attempt < 9; attempt++) {
        active();
        const result = await boundedJson(
          await browserRequest(`/tabs/${encodeURIComponent(tab.tabId)}/evaluate`, {
            userId: run.accountId,
            expression: `(${pageProgram})(${JSON.stringify(profile)},${JSON.stringify(mode)},${JSON.stringify(conversationRef ?? null)})`,
          }),
        );
        if (!result.ok) throw new Error("inbox_read_failed");
        if (result.result?.retry === "loading") {
          if (attempt === 8) throw new Error("inbox_loading_timeout");
          await delay(250, undefined, { signal });
          continue;
        }
        if (
          ["needs_login", "needs_2fa", "checkpoint", "page_contract_failed"].includes(
            result.result?.attention,
          )
        ) {
          const error = new Error("inbox_operator_attention");
          error.attention = result.result.attention;
          throw error;
        }
        return result.result;
      }
    };
    try {
      if (
        run.kind !== "inbox" ||
        !run.id ||
        !run.accountId ||
        run.channelRef !== profile.channelRef ||
        run.accountRef !== profile.accountRef
      )
        throw new Error("inbox_scope_invalid");
      const threads = await read(profile.url, "list");
      let messageCount = 0;
      for (const thread of threads) {
        const messages = await read(thread.url, "thread", thread.conversationRef);
        // Small batches bound UTF-8 JSON below the node HTTP limit even for 20k bodies.
        for (let offset = 0; offset < messages.length; offset += 2) {
          active();
          const batch = messages.slice(offset, offset + 2);
          if (messageCount + batch.length > 200) throw new Error("inbox_scan_size_limit");
          await reportInbound(batch, new Date().toISOString());
          messageCount += batch.length;
        }
      }
      const finalThreads = await read(profile.url, "list");
      const references = (list) =>
        list.map((item) => `${item.conversationRef}\0${item.url}`).sort();
      if (JSON.stringify(references(threads)) !== JSON.stringify(references(finalThreads)))
        throw new Error("inbox_list_changed");
      active();
      await reportInbound([], new Date().toISOString(), {
        reviewRef: profile.reviewRef,
        scanStartedAt,
        coverage: "visible_inbox",
        conversationCount: threads.length,
        messageCount,
      });
      return "completed";
    } catch (error) {
      if (
        ["needs_login", "needs_2fa", "checkpoint", "page_contract_failed"].includes(
          error?.attention,
        )
      )
        return error.attention;
      if (
        ["inbox_scan_size_limit", "inbox_profile_expired", "inbox_navigation_invalid"].includes(
          error?.message,
        )
      )
        return "page_contract_failed";
      // No error text or message body escapes into controller logs or diagnostics.
      return "failed";
    }
  };
}
