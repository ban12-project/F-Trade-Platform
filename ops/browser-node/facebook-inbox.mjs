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
  if (value.pagination !== undefined) {
    if (
      !value.pagination ||
      typeof value.pagination !== "object" ||
      Array.isArray(value.pagination) ||
      Object.keys(value.pagination).some((key) => !["list", "thread"].includes(key))
    )
      throw new Error("inbox_pagination_invalid");
    for (const config of Object.values(value.pagination)) {
      if (
        !config ||
        typeof config !== "object" ||
        Array.isArray(config) ||
        Object.keys(config).sort().join(",") !== "container,end,start" ||
        Object.values(config).some(
          (selector) =>
            typeof selector !== "string" ||
            !selector.trim() ||
            selector.length > 500 ||
            selector.includes(","),
        )
      )
        throw new Error("inbox_pagination_invalid");
    }
  }
  return structuredClone(value);
}

// Observation-only page code, with optional reviewed container scrolling. Never clicks or types.

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
      return collect(mode, conversationRef);
    };
    const evaluate = async (mode, conversationRef, advance) => {
      for (let attempt = 0; attempt < 9; attempt++) {
        active();
        const result = await boundedJson(
          await browserRequest(`/tabs/${encodeURIComponent(tabId)}/evaluate`, {
            userId: run.accountId,
            expression: `(${pageProgram})(${JSON.stringify(profile)},${JSON.stringify(mode)},${JSON.stringify(conversationRef ?? null)},${JSON.stringify(advance ?? null)})`,
          }),
        );
        if (!result.ok) throw new Error("inbox_read_failed");
        if (result.result?.retry === "loading") {
          if (attempt === 8) throw new Error("inbox_loading_timeout");
          await delay(250, undefined, { signal });
          continue;
        }
        if (result.result?.retry) throw new Error("inbox_page_changed");
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
    const collect = async (mode, conversationRef) => {
      let page = await evaluate(mode, conversationRef);
      if (!profile.pagination?.[mode]) return page;
      if (!page.atStart)
        throw Object.assign(new Error("inbox_start_missing"), {
          attention: "page_contract_failed",
        });
      const records = new Map();
      let bodySize = 0;
      for (let step = 0; step < 40; step++) {
        if (!Array.isArray(page.items) || !Array.isArray(page.cursor?.ids))
          throw new Error("inbox_page_invalid");
        for (const item of page.items) {
          const key = mode === "list" ? item.conversationRef : item.messageRef;
          const prior = records.get(key);
          if (prior && JSON.stringify(prior) !== JSON.stringify(item))
            throw Object.assign(new Error("inbox_page_conflict"), {
              attention: "page_contract_failed",
            });
          if (!prior && mode === "thread") {
            bodySize += item.body.length;
            if (bodySize > 200000) throw new Error("inbox_scan_size_limit");
          }
          records.set(key, item);
          if (records.size > 200) throw new Error("inbox_scan_size_limit");
        }
        if (page.atEnd) return [...records.values()];
        if (step === 39) throw new Error("inbox_scan_size_limit");
        const previous = page;
        const advanced = await evaluate(mode, conversationRef, previous.cursor);
        if (advanced.advanced !== true) throw new Error("inbox_scroll_failed");
        for (let attempt = 0; attempt < 9; attempt++) {
          await delay(250, undefined, { signal });
          page = await evaluate(mode, conversationRef);
          if (JSON.stringify(page.cursor) !== JSON.stringify(previous.cursor) || page.atEnd) break;
          if (attempt === 8) throw new Error("inbox_scroll_stalled");
        }
        // Half-viewport scrolling must preserve a stable anchor across pages.
        // Refuse a gap rather than claiming that skipped records were observed.
        if (!page.cursor?.ids.some((id) => previous.cursor.ids.includes(id)))
          throw Object.assign(new Error("inbox_page_gap"), { attention: "page_contract_failed" });
      }
      throw new Error("inbox_scan_size_limit");
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
      let pending = [];
      for (const thread of threads) {
        const messages = await read(thread.url, "thread", thread.conversationRef);
        // Carry the odd record across threads so 200 records fit 100 signed batches.
        for (const message of messages) {
          active();
          if (messageCount >= 200) throw new Error("inbox_scan_size_limit");
          pending.push(message);
          messageCount++;
          if (pending.length === 2) {
            await reportInbound(pending, new Date().toISOString());
            pending = [];
          }
        }
      }
      if (pending.length) {
        active();
        await reportInbound(pending, new Date().toISOString());
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
