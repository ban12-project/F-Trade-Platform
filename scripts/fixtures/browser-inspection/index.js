import { syntheticPage } from "./data.mjs";

// Mounted only into the network-none image test; never copied into runtime images.
export function register(_app, ctx, config = {}) {
  if (config.enabled !== true) throw new Error("synthetic_fixture_must_be_explicit");
  ctx.events.on("session:created", ({ context }) => {
    void context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      const kind = url.searchParams.get("synthetic-inspection");
      if (
        !route.request().isNavigationRequest() ||
        url.origin !== "https://www.facebook.com" ||
        url.pathname !== "/" ||
        ![
          "empty",
          "nonempty",
          "friends",
          "ambiguous",
          "wrong-identity",
          "page-error",
          "tracked",
          "query-mismatch",
          "tracking-lookalike",
          "open-filtered",
          "open-missing",
          "open-duplicate",
          "closed",
        ].includes(kind)
      )
        return route.abort();
      return route.fulfill({ contentType: "text/html", body: syntheticPage(kind) });
    });
  });
}
