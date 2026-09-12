// Trusted page program, read as source so host transpilers cannot inject helper dependencies.
// biome-ignore lint/correctness/noUnusedVariables: The driver reads and invokes this fixed page source.
function readInbox(profile, mode, expectedConversation, advance) {
  try {
    if (
      Date.now() >= Date.parse(profile.expiresAt) ||
      location.origin !== "https://www.facebook.com"
    )
      throw new Error("inbox_page_invalid");
    const visible = (el) =>
      !!el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
    const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
    const one = (root, selector) => {
      const found = all(root, selector);
      if (found.length !== 1) throw new Error("inbox_control_ambiguous");
      return found[0];
    };
    const attention = [
      ["loginRequired", "needs_login"],
      ["twoFactorRequired", "needs_2fa"],
      ["challenge", "checkpoint"],
    ].filter(
      ([selector]) =>
        profile.selectors[selector] && all(document, profile.selectors[selector]).length,
    );
    if (attention.length > 1) throw new Error("inbox_attention_ambiguous");
    if (attention.length) return { attention: attention[0][1] };
    if (all(document, profile.selectors.loading).length) return { retry: "loading" };
    if (one(document, profile.selectors.identity).href !== profile.identityHref)
      throw new Error("inbox_identity_changed");
    if (!["list", "thread"].includes(mode)) throw new Error("inbox_mode_invalid");
    const paging = profile.pagination?.[mode];
    const root = one(document, profile.selectors[mode === "list" ? "inboxReady" : "threadReady"]);
    const container = paging ? one(document, paging.container) : null;
    if (container && container !== root && !root.contains(container))
      throw new Error("inbox_scroll_scope_invalid");
    const inViewport = (element) => {
      if (!container) return true;
      if (!container.contains(element)) return false;
      const a = element.getBoundingClientRect(),
        b = container.getBoundingClientRect();
      return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
    };
    const itemsInView = (selector) => all(root, selector).filter(inViewport);
    const finish = (items, ids) => {
      if (!paging) return items;
      if (
        container.clientHeight < 40 ||
        !["auto", "scroll"].includes(getComputedStyle(container).overflowY)
      )
        throw new Error("inbox_scroll_container_invalid");
      const marker = (selector) => {
        const matches = all(container, selector).filter(inViewport);
        if (matches.length > 1) throw new Error("inbox_scroll_marker_ambiguous");
        return matches.length === 1;
      };
      const cursor = { ids, top: container.scrollTop };
      const atStart = marker(paging.start),
        atEnd = marker(paging.end);
      if (advance) {
        if (JSON.stringify(cursor) !== JSON.stringify(advance)) return { retry: "page_changed" };
        if (atEnd) throw new Error("inbox_scroll_after_end");
        container.scrollTo({
          top: cursor.top + container.clientHeight * (mode === "list" ? 0.5 : -0.5),
          behavior: "instant",
        });
        return { advanced: true };
      }
      return { items, cursor, atStart, atEnd };
    };
    const reference = (el, attr) => {
      const value = el.getAttribute(attr);
      if (!value || !value.trim() || value.length > 200 || value !== value.trim())
        throw new Error("inbox_reference_missing");
      return value;
    };
    if (mode === "list") {
      if (
        location.href !== profile.url ||
        (!paging && all(document, profile.selectors.moreThreads).length)
      )
        throw new Error("inbox_list_incomplete");
      const links = itemsInView(profile.selectors.conversationLink);
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
      return finish(
        result,
        result.map((item) => item.conversationRef),
      );
    }
    if (
      !location.pathname.startsWith("/messages/t/") ||
      decodeURIComponent(location.pathname.slice("/messages/t/".length)) !== expectedConversation ||
      location.search ||
      location.hash
    )
      throw new Error("inbox_thread_location_changed");
    if (!paging && all(document, profile.selectors.moreMessages).length)
      throw new Error("inbox_thread_incomplete");
    if (
      reference(one(root, profile.selectors.threadIdentity), profile.attributes.conversationId) !==
      expectedConversation
    )
      throw new Error("inbox_thread_changed");
    const elements = itemsInView(profile.selectors.message);
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
    return finish(messages, [...ids]);
  } catch {
    return { attention: "page_contract_failed" };
  }
}
