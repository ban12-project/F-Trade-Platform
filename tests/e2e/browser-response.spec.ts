import { expect, test } from "@playwright/test";
import { checkedBrowserResponse } from "../../ops/browser-node/browser-response.mjs";

test("only a read-only hover forwards its 422 response for exact code validation", async () => {
  const hover = new Response(JSON.stringify({ code: "element_not_actionable" }), { status: 422 });
  expect(await checkedBrowserResponse(hover, "/act", { kind: "hover" })).toBe(hover);
  expect(await hover.json()).toEqual({ code: "element_not_actionable" });

  await expect(
    checkedBrowserResponse(new Response("bad request", { status: 422 }), "/act", {
      kind: "click",
    }),
  ).rejects.toThrow("browser_request_failed");
  await expect(
    checkedBrowserResponse(new Response("bad request", { status: 422 }), "/tabs/1/evaluate", {
      kind: "hover",
    }),
  ).rejects.toThrow("browser_request_failed");
  await expect(
    checkedBrowserResponse(new Response("service error", { status: 500 }), "/act", {
      kind: "hover",
    }),
  ).rejects.toThrow("browser_request_failed");
});
