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
  for (const key of ["conversationId", "messageId"])
    if (!/^data-[a-z][a-z0-9-]{1,60}$/.test(value.attributes?.[key] ?? ""))
      throw new Error("inbox_profile_attributes_invalid");
  return structuredClone(value);
}

// Read-only page code. Never clicks a reply control, types, sends or scrolls.
function readInbox(profile, mode, expectedConversation) {
  if (Date.now() >= Date.parse(profile.expiresAt) || location.origin !== "https://www.facebook.com")
    throw new Error("inbox_page_invalid");
  const visible = (el) =>
    !!el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
  const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
  const one = (root, selector) => {
    const found = all(root, selector);
    if (found.length !== 1) throw new Error("inbox_control_ambiguous");
    return found[0];
  };
  if (all(document, profile.selectors.challenge).length) throw new Error("inbox_challenge");
  if (all(document, profile.selectors.loading).length) throw new Error("inbox_incomplete");
  if (one(document, profile.selectors.identity).href !== profile.identityHref)
    throw new Error("inbox_identity_changed");
  const reference = (el, attr) => {
    const value = el.getAttribute(attr);
    if (!value || !value.trim() || value.length > 200 || value !== value.trim())
      throw new Error("inbox_reference_missing");
    return value;
  };
  if (mode === "list") {
    if (location.href !== profile.url || all(document, profile.selectors.moreThreads).length)
      throw new Error("inbox_list_incomplete");
    const root = one(document, profile.selectors.inboxReady);
    const links = all(root, profile.selectors.conversationLink);
    if (
      links.length > 20 ||
      (!links.length && all(root, profile.selectors.emptyInbox).length !== 1)
    )
      throw new Error("inbox_list_incomplete");
    const result = links.map((link) => {
      const conversationRef = reference(link, profile.attributes.conversationId);
      const url = new URL(link.href);
      if (
        url.origin !== "https://www.facebook.com" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.startsWith("/messages/t/") ||
        decodeURIComponent(url.pathname.slice("/messages/t/".length)) !== conversationRef
      )
        throw new Error("inbox_thread_link_invalid");
      return { conversationRef, url: url.href };
    });
    if (new Set(result.map((item) => item.conversationRef)).size !== result.length)
      throw new Error("inbox_duplicate_thread");
    return result;
  }
  if (all(document, profile.selectors.moreMessages).length)
    throw new Error("inbox_thread_incomplete");
  const root = one(document, profile.selectors.threadReady);
  if (
    reference(one(root, profile.selectors.threadIdentity), profile.attributes.conversationId) !==
    expectedConversation
  )
    throw new Error("inbox_thread_changed");
  const elements = all(root, profile.selectors.message);
  if (
    elements.length > 100 ||
    (!elements.length && all(root, profile.selectors.emptyThread).length !== 1)
  )
    throw new Error("inbox_thread_incomplete");
  const ids = new Set();
  const messages = [];
  let size = 0;
  for (const element of elements) {
    const messageRef = reference(element, profile.attributes.messageId);
    if (ids.has(messageRef)) throw new Error("inbox_duplicate_message");
    ids.add(messageRef);
    const inbound = element.matches(profile.selectors.inbound),
      outbound = element.matches(profile.selectors.outbound);
    if (inbound === outbound) throw new Error("inbox_direction_ambiguous");
    if (outbound) continue;
    const rawTime = one(element, profile.selectors.time).getAttribute("datetime");
    const time = Date.parse(rawTime);
    if (
      !rawTime ||
      !/^\d{4}-\d{2}-\d{2}T/.test(rawTime) ||
      !Number.isFinite(time) ||
      time > Date.now()
    )
      throw new Error("inbox_message_time_invalid");
    if (Date.now() - time >= 30 * 86400000) continue;
    const body = one(element, profile.selectors.body).innerText.trim();
    if (!body || body.length > 20000) throw new Error("inbox_message_body_invalid");
    size += body.length;
    if (size > 200000) throw new Error("inbox_thread_size_limit");
    messages.push({
      conversationRef: expectedConversation,
      messageRef,
      direction: "inbound",
      identityQuality: "dom_id",
      body,
      receivedAt: new Date(time).toISOString(),
    });
  }
  return messages;
}
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
      const result = await boundedJson(
        await browserRequest(`/tabs/${encodeURIComponent(tab.tabId)}/evaluate`, {
          userId: run.accountId,
          expression: `(${readInbox.toString()})(${JSON.stringify(profile)},${JSON.stringify(mode)},${JSON.stringify(conversationRef ?? null)})`,
        }),
      );
      if (!result.ok) throw new Error("inbox_read_failed");
      return result.result;
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
    } catch {
      // No error text or message body escapes into controller logs or diagnostics.
      return "failed";
    }
  };
}
