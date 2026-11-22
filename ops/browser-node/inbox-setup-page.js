// Read-only discovery: never clicks, types, uploads, navigates, or reads message text.
// biome-ignore lint/correctness/noUnusedVariables: Invoked as fixed source by inbox-setup.
function observeInboxSetup(expectedAccountRef) {
  try {
    if (location.origin !== "https://www.facebook.com")
      return { stage: "page", verified: false, threadCount: 0, emptyInbox: false };
    const visible = (el) =>
      !el.closest('[aria-hidden="true"], [inert]') &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden";
    const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
    if (
      /^\/login(?:\/|\.php)?$/.test(location.pathname) ||
      all(document, 'form input[name="pass"], form input[type="password"]').length > 0 ||
      location.pathname.startsWith("/two_step_verification/") ||
      location.pathname.startsWith("/checkpoint/")
    )
      return { stage: "attention", verified: false, threadCount: 0, emptyInbox: false };

    let visited = 0;
    let scannedCharacters = 0;
    let identityCharacters = 0;
    const records = [];
    const walk = (value, depth = 0) => {
      if (++visited > 200000 || depth > 80) throw new Error("identity_limit");
      if (Array.isArray(value)) {
        if (value[0] === "CurrentUserInitialData") {
          const data = value[2];
          if (!data || typeof data !== "object") throw new Error("identity_invalid");
          if (data.USER_ID !== "0" || data.ACCOUNT_ID !== "0") records.push(data);
        }
        for (const item of value) walk(item, depth + 1);
      } else if (value && typeof value === "object") {
        for (const item of Object.values(value)) walk(item, depth + 1);
      }
    };
    const scripts = document.querySelectorAll('script[type="application/json"]');
    if (scripts.length > 256) throw new Error("identity_limit");
    for (const script of scripts) {
      const content = script.textContent ?? "";
      scannedCharacters += content.length;
      if (scannedCharacters > 16000000) throw new Error("identity_limit");
      if (content.includes("CurrentUserInitialData")) {
        identityCharacters += content.length;
        if (identityCharacters > 4000000) throw new Error("identity_limit");
        walk(JSON.parse(content));
      }
    }
    if (!records.length)
      return { stage: "page", verified: false, threadCount: 0, emptyInbox: false };
    if (
      records.some(
        (data) =>
          String(data.USER_ID) !== expectedAccountRef ||
          String(data.ACCOUNT_ID) !== expectedAccountRef,
      )
    )
      return { stage: "identity", verified: false, threadCount: 0, emptyInbox: false };

    const onMessagesPath =
      location.pathname === "/messages" ||
      location.pathname === "/messages/" ||
      /^\/messages\/(?:e2ee\/)?t\/[^/]+\/?$/.test(location.pathname);
    if (!onMessagesPath || location.search || location.hash)
      return { stage: "page", verified: false, threadCount: 0, emptyInbox: false };

    const grids = all(document, '[role="grid"][aria-label="Chats"]');
    const hasNoChats = all(
      document,
      '[role="tabpanel"][aria-label="All chats"], [role="navigation"][aria-label="Thread list"], [role="main"]',
    ).some((container) =>
      [...container.querySelectorAll("*")]
        .filter(visible)
        .some((el) => el.children.length === 0 && el.textContent?.trim() === "No chats"),
    );

    if (grids.length === 1) {
      const seen = new Set();
      for (const link of all(grids[0], "a[href]")) {
        const target = new URL(link.getAttribute("href"), location.href);
        if (target.origin !== "https://www.facebook.com" || target.search || target.hash) continue;
        const match = /^\/messages\/(?:e2ee\/)?t\/([^/]+)\/?$/.exec(target.pathname);
        if (match) seen.add(decodeURIComponent(match[1]));
      }
      if (seen.size > 0)
        return {
          stage: "inbox",
          verified: true,
          threadCount: Math.min(seen.size, 200),
          emptyInbox: false,
        };
    }
    if (hasNoChats) return { stage: "inbox", verified: true, threadCount: 0, emptyInbox: true };
    return { stage: "page", verified: false, threadCount: 0, emptyInbox: false };
  } catch {
    return { stage: "page", verified: false, threadCount: 0, emptyInbox: false };
  }
}
