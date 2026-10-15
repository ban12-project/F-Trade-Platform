import assert from "node:assert/strict";
import { checkedBrowserResponse } from "/fixture/runtime/browser-response.mjs";
import { createFacebookDriver } from "/fixture/runtime/facebook-driver.mjs";

const profile = {
  version: 1,
  accountRef: "synthetic-account",
  channelRef: "synthetic-channel",
  reviewRef: "evidence-synthetic-dom-only",
  reviewedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  url: "https://www.facebook.com/synthetic-composer",
  identityHref: "https://www.facebook.com/synthetic-owner",
  receiptUrl: "https://www.facebook.com/synthetic-owner",
  receiptScroll: 850,
  videoReceipt: { mode: "captioned_post" },
  audienceText: "Only me",
  selectors: {
    identity: "#identity",
    receiptIdentity: "#identity",
    openComposer: "#open",
    composer: "#composer",
    textbox: "textarea",
    submit: "button",
    audience: ".audience",
    fileInput: "input",
    attachmentName: ".filename",
    postsReady: "#feed",
    post: "article",
    postAuthor: ".author",
    postText: ".copy",
    postLink: ".permalink",
  },
};
const headers = {
  "content-type": "application/json",
  authorization: "Bearer SYNTHETIC-observation-fixture-key",
};
const userId = process.argv[2] ?? "synthetic-stale";
const legacy = process.argv[3] === "legacy";
const requests = [];
const controller = new AbortController();
const browserRequest = async (path, body) => {
  const step = body.expression?.match(/"kind":"([a-z-]+)"/)?.[1];
  assert.ok(path === "/tabs" || /\/(navigate|scroll|evaluate)$/.test(path));
  assert.ok(
    !step ||
      [
        "identity-ready",
        "identity",
        "composer-closed",
        "posts-ready",
        "posts-loaded",
        "posts",
      ].includes(step),
  );
  const response = await fetch(`http://127.0.0.1:9377${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    // HTTP health precedes cold Firefox startup; match the image smoke test's
    // reviewed create-tab bound rather than timing out before the browser opens.
    signal: AbortSignal.timeout(path === "/tabs" ? 30000 : 15000),
  });
  requests.push({ path: path.split("/").at(-1), step, status: response.status });
  return checkedBrowserResponse(response, path, body);
};
const driver = createFacebookDriver(profile, browserRequest);
let session;
let error;
let observation;
try {
  session = await driver.open(
    {
      id: "synthetic-run",
      accountId: userId,
      accountRef: profile.accountRef,
      channelRef: profile.channelRef,
      publication: { format: "video" },
    },
    controller.signal,
  );
  await driver.identity(session);
  session.baseline = new Set(["https://www.facebook.com/reel/99"]);
  try {
    observation = await driver.observe(
      session,
      { format: "video", text: "SYNTHETIC approved copy" },
      controller.signal,
    );
  } catch (failure) {
    error = failure.message;
  }
  const navigations = requests.filter((request) => request.path === "navigate").length;
  if (legacy) {
    assert.equal(error, "facebook_video_receipt_not_observed");
    assert.equal(navigations, 1);
  } else if (userId === "synthetic-stale") {
    assert.equal(error, undefined);
    assert.equal(observation.externalPublicationRef, "https://www.facebook.com/reel/1");
    assert.equal(navigations, 2);
  } else {
    const failures = {
      "synthetic-missing": "facebook_receipt_post_missing",
      "synthetic-baseline": "facebook_receipt_baseline_only",
      "synthetic-wrong-author": "facebook_receipt_identity_mismatch",
      "synthetic-no-video": "facebook_receipt_video_missing",
      "synthetic-wrong-link": "facebook_receipt_reel_link_unverified",
    };
    assert.equal(error, failures[userId]);
    assert.equal(navigations, 3);
  }
  assert.equal(session.observationRetriesLeft, undefined);
  console.log(
    JSON.stringify({
      syntheticCase: userId,
      legacy,
      error,
      verified: !!observation,
      navigations,
      reads: requests.filter((r) => r.step === "posts").length,
      httpStatuses: [...new Set(requests.map((r) => r.status))],
      externalEffects: 0,
    }),
  );
} finally {
  if (session) {
    // Each scenario uses a different synthetic user. Release the whole session
    // so the next one runs under the production MAX_SESSIONS=1 limit.
    const response = await fetch(`http://127.0.0.1:9377/sessions/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    await response.body?.cancel();
  }
}
