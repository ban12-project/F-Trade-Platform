import assert from "node:assert/strict";
import { checkedBrowserResponse } from "/fixture/runtime/browser-response.mjs";
import { createFacebookInbox } from "/fixture/runtime/facebook-inbox.mjs";

const mode = process.argv[2];
assert.ok(["normal", "missing-id", "ambiguous-direction", "wrong-identity"].includes(mode));
const accountId = `synthetic-inbox-${mode}`;
const headers = {
  "content-type": "application/json",
  authorization: "Bearer SYNTHETIC-observation-fixture-key",
};
const requests = [];
const browserRequest = async (path, body) => {
  assert.ok(path === "/tabs" || /\/(navigate|evaluate)$/.test(path));
  requests.push(path.split("/").at(-1));
  const response = await fetch(`http://127.0.0.1:9377${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(path === "/tabs" ? 30000 : 15000),
  });
  return checkedBrowserResponse(response, path, body);
};
const profile = {
  version: 1,
  accountRef: "synthetic-account",
  channelRef: "synthetic-channel",
  reviewRef: "evidence-synthetic-native-inbox",
  reviewedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  url: "https://www.facebook.com/messages",
  identityHref: "https://www.facebook.com/synthetic-owner",
  selectors: {
    identity: "#identity",
    inboxReady: "#inbox",
    conversationLink: "a.thread",
    emptyInbox: ".empty",
    threadReady: "#thread",
    threadIdentity: "h1",
    message: ".message",
    inbound: ".incoming",
    outbound: ".outgoing",
    body: ".body",
    time: "time",
    emptyThread: ".empty",
    challenge: ".challenge",
    loading: ".loading",
    moreThreads: ".more-threads",
    moreMessages: ".more-messages",
  },
  attributes: { conversationId: "data-thread-id", messageId: "data-message-id" },
};
try {
  const captures = [];
  for (let attempt = 0; attempt < (mode === "normal" ? 2 : 1); attempt++) {
    const messages = [];
    const completions = [];
    const outcome = await createFacebookInbox(
      profile,
      browserRequest,
    )({
      run: {
        kind: "inbox",
        id: `synthetic-inbox-run-${attempt}`,
        accountId,
        accountRef: profile.accountRef,
        channelRef: profile.channelRef,
      },
      signal: new AbortController().signal,
      reportInbound: async (batch, _observedAt, completion) => {
        messages.push(...batch);
        if (completion) completions.push(completion);
      },
    });
    if (mode === "normal") {
      assert.equal(outcome, "completed");
      assert.equal(messages.length, 1);
      assert.equal(messages[0].conversationRef, "thread-1");
      assert.equal(messages[0].messageRef, "message-1");
      assert.equal(messages[0].direction, "inbound");
      assert.equal(messages[0].identityQuality, "dom_id");
      assert.equal(messages[0].body, "SYNTHETIC inquiry");
      assert.equal(completions.length, 1);
      assert.equal(completions[0].coverage, "visible_inbox");
      assert.equal(completions[0].messageCount, 1);
      captures.push(messages[0].messageRef);
    } else {
      assert.equal(outcome, "page_contract_failed");
      assert.equal(messages.length, 0);
      assert.equal(completions.length, 0);
    }
    const response = await fetch(
      `http://127.0.0.1:9377/sessions/${encodeURIComponent(accountId)}`,
      { method: "DELETE", headers, signal: AbortSignal.timeout(5000) },
    );
    assert.equal(response.status, 200);
    await response.body?.cancel();
  }
  if (mode === "normal") assert.deepEqual(captures, ["message-1", "message-1"]);
  console.log(
    JSON.stringify({
      syntheticInboxCase: mode,
      verified: true,
      requests: requests.length,
      externalEffects: 0,
    }),
  );
} finally {
  // Also release sessions when an assertion or native HTTP request fails.
  const response = await fetch(`http://127.0.0.1:9377/sessions/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();
}
