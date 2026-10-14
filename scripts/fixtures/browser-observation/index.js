// Test-only plugin, mounted into a network-none container, never a runtime image.
export function register(_app, ctx, config = {}) {
  if (config.enabled !== true) throw new Error("synthetic_fixture_must_be_explicit");
  ctx.events.on("session:created", async ({ userId, context }) => {
    let feedLoads = 0;
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (!route.request().isNavigationRequest() || url.origin !== "https://www.facebook.com")
        return route.abort();
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
