// Trusted page program, read as source so host transpilers cannot inject helper dependencies.
// biome-ignore lint/correctness/noUnusedVariables: The live inbox agent reads and invokes this fixed source.
function readLiveFacebookInbox(profile, mode, expectedConversation) {
  try {
    if (
      Date.now() >= Date.parse(profile.expiresAt) ||
      location.origin !== "https://www.facebook.com"
    )
      return { attention: "page_contract_failed", reason: "origin_or_expiry" };
    const visible = (el) =>
      !el.closest('[aria-hidden="true"], [inert]') &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden";
    const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
    if (
      /^\/login(?:\/|\.php)?$/.test(location.pathname) ||
      all(document, 'form input[name="pass"], form input[type="password"]').length > 0
    )
      return { attention: "needs_login" };
    if (location.pathname.startsWith("/two_step_verification/")) return { attention: "needs_2fa" };
    if (location.pathname.startsWith("/checkpoint/")) return { attention: "checkpoint" };

    // Verify logged-in account via CurrentUserInitialData without DOM identity-link coupling.
    let visited = 0;
    let scannedCharacters = 0;
    let identityCharacters = 0;
    const records = [];
    const walk = (value, depth = 0) => {
      if (++visited > 200000 || depth > 80) throw new Error("inbox_identity_limit");
      if (Array.isArray(value)) {
        if (value[0] === "CurrentUserInitialData") {
          const data = value[2];
          if (!data || typeof data !== "object") throw new Error("inbox_identity_invalid");
          if (data.USER_ID !== "0" || data.ACCOUNT_ID !== "0") records.push(data);
        }
        for (const item of value) walk(item, depth + 1);
      } else if (value && typeof value === "object") {
        for (const item of Object.values(value)) walk(item, depth + 1);
      }
    };
    const scripts = document.querySelectorAll('script[type="application/json"]');
    if (scripts.length > 256) throw new Error("inbox_identity_limit");
    for (const script of scripts) {
      const content = script.textContent ?? "";
      scannedCharacters += content.length;
      if (scannedCharacters > 16000000) throw new Error("inbox_identity_limit");
      if (content.includes("CurrentUserInitialData")) {
        identityCharacters += content.length;
        if (identityCharacters > 4000000) throw new Error("inbox_identity_limit");
        walk(JSON.parse(content));
      }
    }
    if (!records.length) return { retry: "loading" };
    if (
      records.some(
        (data) =>
          String(data.USER_ID) !== profile.expectedAccountRef ||
          String(data.ACCOUNT_ID) !== profile.expectedAccountRef,
      )
    )
      return { attention: "page_contract_failed", reason: "identity_mismatch" };

    const parseThreadPath = (pathname) => {
      const match = /^\/messages\/(?:(e2ee)\/)?t\/([^/]+)\/?$/.exec(pathname);
      if (!match) return null;
      const e2ee = match[1] === "e2ee";
      const conversationRef = decodeURIComponent(match[2]);
      if (!conversationRef || conversationRef.length > 200) return null;
      return {
        e2ee,
        conversationRef,
        canonicalUrl: `https://www.facebook.com/messages/${e2ee ? "e2ee/t/" : "t/"}${encodeURIComponent(conversationRef)}/`,
      };
    };

    if (mode === "list") {
      const currentThread = parseThreadPath(location.pathname);
      if (
        (location.pathname !== "/messages" &&
          location.pathname !== "/messages/" &&
          !currentThread) ||
        location.search ||
        location.hash
      )
        throw new Error("inbox_list_location_invalid");
      const grids = all(document, '[role="grid"][aria-label="Chats"]');
      if (grids.length > 1) throw new Error("inbox_control_ambiguous");
      const hasNoChatsText = () =>
        all(
          document,
          '[role="tabpanel"][aria-label="All chats"], [role="navigation"][aria-label="Thread list"], [role="main"]',
        ).some((container) =>
          [...container.querySelectorAll("*")]
            .filter(visible)
            .some((el) => el.children.length === 0 && el.textContent?.trim() === "No chats"),
        );
      if (grids.length === 0) {
        if (hasNoChatsText()) return { mode: "list", empty: true, threads: [] };
        return { retry: "loading" };
      }
      const grid = grids[0];
      const links = all(grid, "a[href]");
      const threads = [];
      const seen = new Set();
      for (const link of links) {
        const target = new URL(link.getAttribute("href"), location.href);
        if (
          target.origin !== "https://www.facebook.com" ||
          target.username ||
          target.password ||
          target.search ||
          target.hash
        )
          continue;
        const parsed = parseThreadPath(target.pathname);
        if (!parsed || seen.has(parsed.conversationRef)) continue;
        seen.add(parsed.conversationRef);
        threads.push({
          conversationRef: parsed.conversationRef,
          url: parsed.canonicalUrl,
        });
        if (threads.length > 20) throw new Error("inbox_list_limit");
      }
      if (!threads.length) {
        if (hasNoChatsText()) return { mode: "list", empty: true, threads: [] };
        return { retry: "loading" };
      }
      return { mode: "list", empty: false, threads };
    }

    if (mode === "thread") {
      const parsedLocation = parseThreadPath(location.pathname);
      if (
        !parsedLocation ||
        parsedLocation.conversationRef !== expectedConversation ||
        location.search ||
        location.hash
      )
        throw new Error("inbox_thread_location_changed");
      let logs = all(
        document,
        '[role="main"] [role="log"][aria-label^="Messages in conversation with "]',
      );
      if (!logs.length) {
        const genericLogs = all(document, '[role="main"] [role="log"]');
        if (genericLogs.length === 1) logs = genericLogs;
      }
      if (!logs.length) return { retry: "loading" };
      if (logs.length > 1) throw new Error("inbox_control_ambiguous");
      const log = logs[0];
      const rows = all(log, 'div[data-scope="messages_table"][data-message-id]');
      if (rows.length > 100) throw new Error("inbox_thread_incomplete");
      const seenIds = new Set();
      const messages = [];
      let skippedNonText = 0;
      let totalSize = 0;
      for (const el of rows) {
        const messageRef = el.getAttribute("data-message-id")?.trim();
        if (!messageRef || messageRef.length > 200 || seenIds.has(messageRef))
          throw new Error("inbox_message_id_invalid");
        seenIds.add(messageRef);
        const headings = all(el, "h4")
          .map((node) => node.innerText.trim())
          .filter(Boolean);
        const h4Out = headings.some((text) => text === "You sent");
        const h4In = headings.some((text) => text !== "You sent");
        const label = el.getAttribute("aria-label") ?? "";
        const labelSender = /^At\s+[^,]+,\s*([^:]+):/.exec(label)?.[1]?.trim() ?? "";
        const labelOut = labelSender === "You" || /\bby You:/.test(label);
        const labelIn = labelSender.length > 0 && labelSender !== "You";
        const isOutbound = h4Out || labelOut;
        const isInbound = h4In || labelIn;
        if (isOutbound === isInbound) throw new Error("inbox_direction_ambiguous");
        if (isOutbound) continue;

        let timestampMs = NaN;
        const snowflake = /@msgr\.(\d{15,22})$/.exec(messageRef);
        if (snowflake) {
          timestampMs = Number(BigInt(snowflake[1]) >> 22n);
        } else {
          const timeEls = all(el, "time[datetime]");
          if (timeEls.length === 1) {
            const rawTime = timeEls[0].getAttribute("datetime") ?? "";
            if (/^\d{4}-\d{2}-\d{2}T/.test(rawTime)) timestampMs = Date.parse(rawTime);
          }
        }
        if (
          !Number.isFinite(timestampMs) ||
          timestampMs < Date.UTC(2020, 0, 1) ||
          timestampMs > Date.now() + 5000
        )
          throw new Error("inbox_message_time_invalid");
        const clampedTime = Math.min(timestampMs, Date.now());
        if (Date.now() - clampedTime >= 30 * 86400000) continue;

        const candidates = all(el, 'div[dir="auto"]').filter(
          (node) =>
            !node.closest(
              'h4, [role="toolbar"], [role="button"][aria-label^="Enter, Message sent"]',
            ),
        );
        const outermost = candidates.filter(
          (node) => !candidates.some((other) => other !== node && other.contains(node)),
        );
        const body = outermost
          .map((node) => node.innerText.trim())
          .filter(Boolean)
          .join("\n");
        if (!body) {
          const hasMedia =
            el.querySelector("img, video, audio, svg") !== null ||
            /\b(photo|image|video|sticker|gif|audio|voice|file|attachment|sent a)\b/i.test(label);
          if (hasMedia) {
            skippedNonText++;
            continue;
          }
          throw new Error("inbox_message_body_invalid");
        }
        if (body.length > 20000) throw new Error("inbox_message_body_invalid");
        totalSize += body.length;
        if (totalSize > 200000) throw new Error("inbox_thread_size_limit");
        messages.push({
          conversationRef: expectedConversation,
          messageRef,
          direction: "inbound",
          identityQuality: "dom_id",
          body,
          receivedAt: new Date(clampedTime).toISOString(),
        });
      }
      return {
        mode: "thread",
        conversationRef: expectedConversation,
        messages,
        skippedNonText,
      };
    }

    throw new Error("inbox_mode_invalid");
  } catch (error) {
    return {
      attention: "page_contract_failed",
      reason:
        error?.message && /^inbox_[a-z0-9_]{1,60}$/.test(error.message) ? error.message : "unknown",
    };
  }
}
