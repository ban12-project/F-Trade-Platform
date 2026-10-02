import { expect, test } from "@playwright/test";
import { checkedBrowserResponse } from "../../ops/browser-node/browser-response.mjs";
import { describeBrowserLaunchFailure } from "../../ops/browser-node/launch-diagnostics.mjs";

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

test("launch diagnostics retain only reviewed codes and never response details or private paths", async () => {
  const secret = "private-account-cookie-proxy-canary";
  for (const body of [
    { error: "native_profile_launch_failed", detail: secret },
    { error: secret },
    { error: { token: secret } },
    { error: `native_profile_launch_failed ${secret}` },
  ]) {
    const response = Response.json(body, { status: 500 });
    const error = await checkedBrowserResponse(
      response,
      `/tabs/${secret}/snapshot?userId=${secret}`,
    ).catch((failure) => failure);
    const diagnostic = describeBrowserLaunchFailure("egress", error);
    expect(diagnostic).toEqual({
      event: "browser_launch_failed",
      stage: "egress",
      request: "snapshot",
      code: body.error === "native_profile_launch_failed" ? body.error : "unclassified",
      httpStatus: 500,
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
    expect(error.message).toBe("browser_request_failed");
  }
  expect(
    describeBrowserLaunchFailure(secret, {
      message: secret,
      stack: secret,
      browserFailureCode: secret,
      browserRequestStage: secret,
      browserHttpStatus: 123456,
    }),
  ).toEqual({
    event: "browser_launch_failed",
    stage: "unknown",
    request: "unknown",
    code: "unclassified",
    httpStatus: null,
  });
});

test("failed-response diagnostics are size and time bounded and cancel the stream", async () => {
  let cancelled = 0;
  const oversized = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2049));
      },
      cancel() {
        cancelled++;
      },
    }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
  const largeError = await checkedBrowserResponse(oversized, "/tabs").catch((error) => error);
  expect(largeError.browserFailureCode).toBe("unclassified");
  expect(cancelled).toBe(1);
  const stalled = new Response(
    new ReadableStream({
      cancel() {
        cancelled++;
      },
    }),
    {
      status: 503,
      headers: { "content-type": "application/json" },
    },
  );
  const started = Date.now();
  const stalledError = await checkedBrowserResponse(stalled, "/tabs").catch((error) => error);
  expect(stalledError.browserFailureCode).toBe("unclassified");
  expect(Date.now() - started).toBeLessThan(2000);
  expect(cancelled).toBe(2);
});

test("structured production failure codes do not expose error messages or grant retries", async () => {
  for (const code of ["ssl_error", "session_expired", "browser_launch_timeout"]) {
    const error = await checkedBrowserResponse(
      Response.json(
        { code, error: "private-page-and-proxy-canary", retryable: true },
        { status: 503 },
      ),
      "/tabs",
    ).catch((failure) => failure);
    expect(describeBrowserLaunchFailure("egress", error)).toEqual({
      event: "browser_launch_failed",
      stage: "egress",
      request: "open-tab",
      code,
      httpStatus: 503,
    });
    expect(error.message).toBe("browser_request_failed");
    expect(error).not.toHaveProperty("retryable");
    expect(JSON.stringify(error)).not.toContain("canary");
  }
});
