import assert from "node:assert/strict";
import { checkedBrowserResponse } from "/project/browser-node/browser-response.mjs";
import { createFacebookDriver } from "/project/browser-node/facebook-driver.mjs";
import { createFacebookInbox } from "/project/browser-node/facebook-inbox.mjs";
import { register } from "/project-fixtures/browser-observation/index.js";

export async function verifySocialContracts({ context, accountId, runId, accessKey }) {
  const request = async (path, body) =>
    checkedBrowserResponse(
      await fetch(`http://127.0.0.1:9377${path}`, {
        method: body ? "POST" : "GET",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(35000),
      }),
      path,
      body,
    );
  async function scenario(name, verify) {
    const previous = new Set(context.pages());
    let setup;
    register(
      null,
      {
        events: {
          on(_event, fn) {
            setup = fn;
          },
        },
      },
      { enabled: true },
    );
    await setup({ userId: name, context });
    try {
      await verify();
    } finally {
      await context.unroute("**/*");
      for (const page of context.pages()) if (!previous.has(page)) await page.close();
    }
  }
  const common = {
    version: 1,
    accountRef: "synthetic-account",
    channelRef: "synthetic-channel",
    reviewRef: "evidence-official-runtime-fixture",
    reviewedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    identityHref: "https://www.facebook.com/synthetic-owner",
  };
  const profile = {
    ...common,
    url: "https://www.facebook.com/messages",
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
  const ids = [];
  for (const mode of ["normal", "normal", "missing-id", "ambiguous-direction", "wrong-identity"]) {
    await scenario(`synthetic-inbox-${mode}`, async () => {
      const messages = [],
        completions = [];
      const outcome = await createFacebookInbox(
        profile,
        request,
      )({
        run: {
          kind: "inbox",
          id: runId,
          accountId,
          accountRef: profile.accountRef,
          channelRef: profile.channelRef,
        },
        signal: new AbortController().signal,
        reportInbound: async (batch, _time, completion) => {
          messages.push(...batch);
          if (completion) completions.push(completion);
        },
      });
      if (mode === "normal") {
        assert.equal(outcome, "completed");
        assert.equal(messages.length, 1);
        assert.equal(messages[0].messageRef, "message-1");
        assert.equal(messages[0].direction, "inbound");
        assert.equal(completions.length, 1);
        ids.push(messages[0].messageRef);
      } else {
        assert.equal(outcome, "page_contract_failed");
        assert.equal(messages.length, 0);
        assert.equal(completions.length, 0);
      }
    });
  }
  assert.deepEqual(ids, ["message-1", "message-1"]);
  const publicationProfile = {
    ...common,
    url: "https://www.facebook.com/synthetic-composer",
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
  for (const name of ["synthetic-stale", "synthetic-wrong-author"]) {
    await scenario(name, async () => {
      const driver = createFacebookDriver(publicationProfile, request);
      const signal = new AbortController().signal;
      const session = await driver.open(
        {
          id: runId,
          accountId,
          accountRef: common.accountRef,
          channelRef: common.channelRef,
          publication: { format: "video" },
        },
        signal,
      );
      await driver.identity(session);
      session.baseline = new Set(["https://www.facebook.com/reel/99"]);
      if (name === "synthetic-stale") {
        const observed = await driver.observe(
          session,
          { format: "video", text: "SYNTHETIC approved copy" },
          signal,
        );
        assert.equal(observed.externalPublicationRef, "https://www.facebook.com/reel/1");
      } else
        await assert.rejects(
          driver.observe(session, { format: "video", text: "SYNTHETIC approved copy" }, signal),
          /facebook_receipt_identity_mismatch/,
        );
    });
  }
  console.log(
    "PASS existing inbox and publication observation drivers through official HTTP service; synthetic DOM only, no external submission",
  );
}
