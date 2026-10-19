// Test-only plugin, mounted into a network-none container, never a runtime image.
export function register(_app, ctx, config = {}) {
  if (config.enabled !== true) throw new Error("synthetic_fixture_must_be_explicit");
  ctx.events.on("session:created", async ({ userId, context }) => {
    let feedLoads = 0;
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (!route.request().isNavigationRequest() || url.origin !== "https://www.facebook.com")
        return route.abort();
      if (userId.startsWith("synthetic-inbox-")) {
        const mode = userId.slice("synthetic-inbox-".length);
        const owner = mode === "wrong-identity" ? "another-owner" : "synthetic-owner";
        const identity = `<a id="identity" href="https://www.facebook.com/${owner}">Synthetic identity</a>`;
        const time = new Date(Date.now() - 10000).toISOString();
        const message = (id, direction) =>
          `<div class="message ${direction}" ${mode === "missing-id" ? "" : `data-message-id="${id}"`}><p class="body">SYNTHETIC inquiry</p><time datetime="${time}">Synthetic time</time></div>`;
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html>${identity}${url.pathname === "/messages" ? '<main id="inbox"><a class="thread" data-thread-id="thread-1" href="https://www.facebook.com/messages/t/thread-1">Synthetic thread</a></main>' : `<main id="thread"><h1 data-thread-id="thread-1">Synthetic thread</h1>${message("message-1", mode === "ambiguous-direction" ? "incoming outgoing" : "incoming")}${message("message-2", "outgoing")}</main>`}`,
        });
      }
      const feed = url.pathname === "/synthetic-owner";
      if (feed) feedLoads++;
      const fresh = userId !== "synthetic-stale" || feedLoads > 1;
      const copy =
        fresh && userId !== "synthetic-missing"
          ? "SYNTHETIC approved copy"
          : "SYNTHETIC older copy";
      const owner = userId === "synthetic-wrong-author" ? "another-owner" : "synthetic-owner";
      const ref = userId === "synthetic-baseline" ? "99" : "1";
      const link = userId === "synthetic-wrong-link" ? "/synthetic/posts/1" : `/reel/${ref}`;
      const videos = userId === "synthetic-no-video" ? "" : "<video></video>";
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><a id="identity" href="https://www.facebook.com/synthetic-owner">Synthetic identity</a><div id="feed"><article><a class="author" href="https://www.facebook.com/${owner}">Synthetic author</a><p class="copy">${copy}</p><a class="permalink" href="https://www.facebook.com${link}">Synthetic permalink</a>${videos}</article></div>`,
      });
    });
  });
}
