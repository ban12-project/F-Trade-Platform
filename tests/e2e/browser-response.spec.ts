import { expect, test } from "@playwright/test";
import { publicationFailureLabel } from "../../lib/social/publication-presentation";
import { checkedBrowserResponse } from "../../ops/browser-node/browser-response.mjs";
import { describeBrowserLaunchFailure } from "../../ops/browser-node/launch-diagnostics.mjs";
import {
  observationHttpFailure,
  parseObservationHttpFailure,
} from "../../ops/browser-node/observation-diagnostics.mjs";

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

test("observation HTTP diagnostics preserve bounded tokens through presentation", async () => {
  for (const request of ["navigate", "evaluate", "scroll", "hover"]) {
    const error = await checkedBrowserResponse(
      Response.json({ code: "navigation_race", error: "private-canary" }, { status: 409 }),
      request === "hover" ? "/act" : `/tabs/private-canary/${request}`,
      { kind: "hover" },
    ).catch((failure) => failure);
    error.browserObservationStage = "composer-closed";
    const code = observationHttpFailure(error);
    expect(code).toBe(`publication_observe_http_409__${request}__composer_closed__navigation_race`);
    expect(parseObservationHttpFailure(code)).toEqual({
      httpStatus: 409,
      request,
      step: "composer-closed",
      code: "navigation_race",
    });
    expect(publicationFailureLabel(code)).toBe(
      `浏览器观察 HTTP 409（${request} / composer-closed / navigation_race）`,
    );
    expect(JSON.stringify(error)).not.toContain("private-canary");
  }
});

test("untrusted observation metadata cannot reach receipts or presentation", () => {
  const error = {
    message: "browser_request_failed",
    browserHttpStatus: 503,
    browserFailureCode: "private-canary",
    browserRequestStage: "private-canary",
    browserObservationStage: "private-canary",
  };
  expect(observationHttpFailure(error)).toBe(
    "publication_observe_http_503__other__unknown__unclassified",
  );
  for (const status of [0, 200, 299, 600, NaN, 409.5, "409"]) {
    expect(observationHttpFailure({ ...error, browserHttpStatus: status })).toBeNull();
  }
  expect(observationHttpFailure(new Error("private-canary"))).toBeNull();
  for (const code of [
    "publication_observe_http_409__evaluate__composer_closed__private_canary",
    "publication_observe_http_409__private_canary__unknown__unclassified",
    "publication_observe_http_409__evaluate__private_canary__unclassified",
    "publication_observe_http_409__evaluate__composer-closed__navigation_race",
    "publication_observe_http_200__evaluate__composer_closed__navigation_race",
    "publication_observe_http_409__evaluate__composer_closed__navigation_race__extra",
    `publication_observe_http_${"a".repeat(121)}`,
  ]) {
    expect(parseObservationHttpFailure(code)).toBeNull();
    expect(publicationFailureLabel(code)).toBeNull();
  }
  expect(publicationFailureLabel("publication_observe_transport_failed")).toBe(
    "浏览器观察传输失败",
  );
});
