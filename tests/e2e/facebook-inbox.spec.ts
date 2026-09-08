import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { verifyInboxPacket } from "../../lib/browser-fleet/inbox-protocol";
import {
  createFacebookInbox,
  validateInboxProfile,
} from "../../ops/browser-node/facebook-inbox.mjs";
import { createInboxReporter } from "../../ops/browser-node/inbox.mjs";

const profile = {
  version: 1,
  accountRef: "synthetic-account",
  channelRef: "synthetic-channel",
  reviewRef: "evidence-synthetic-inbox",
  reviewedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
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
    loginRequired: ".login",
    twoFactorRequired: ".two-factor",
    loading: ".loading",
    moreThreads: ".more-threads",
    moreMessages: ".more-messages",
  },
  attributes: { conversationId: "data-thread-id", messageId: "data-message-id" },
};
for (const mode of [
  "normal",
  "empty",
  "wrong_identity",
  "missing_id",
  "ambiguous_direction",
  "more_threads",
  "more_messages",
  "challenge",
  "login",
  "two_factor",
  "duplicate_message",
  "wrong_thread",
  "changed_list",
  "lost_receipt",
  "outbound_only",
] as const) {
  test(`read-only inbox collector ${mode}`, async ({ page, context }) => {
    let listReads = 0;
    const time = new Date(Date.now() - 2000).toISOString();
    const identity = `<a id="identity" href="${mode === "wrong_identity" ? "https://www.facebook.com/other" : profile.identityHref}">Identity</a>`;
    const message = (id: string, direction: string) =>
      `<div class="message ${direction}" ${mode === "missing_id" ? "" : `data-message-id="${id}"`}><p class="body">SYNTHETIC incoming request</p><time datetime="${time}">Time</time></div>`;
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url === profile.url) {
        listReads++;
        return route.fulfill({
          contentType: "text/html",
          body: `${identity}<main id="inbox">${mode === "empty" ? '<p class="empty">Empty</p>' : `<a class="thread" data-thread-id="thread-1" href="https://www.facebook.com/messages/t/thread-1">Thread</a>`}${mode === "changed_list" && listReads > 1 ? '<a class="thread" data-thread-id="thread-2" href="https://www.facebook.com/messages/t/thread-2">New</a>' : ""}</main>${mode === "more_threads" ? '<b class="more-threads">More</b>' : ""}${mode === "challenge" ? '<b class="challenge">Challenge</b>' : ""}${mode === "login" ? '<b class="login">Login</b>' : ""}${mode === "two_factor" ? '<b class="two-factor">2FA</b>' : ""}`,
        });
      }
      if (url === "https://www.facebook.com/messages/t/thread-1")
        return route.fulfill({
          contentType: "text/html",
          body: `${identity}<main id="thread"><h1 data-thread-id="${mode === "wrong_thread" ? "other" : "thread-1"}">Thread</h1>${message("msg-1", mode === "ambiguous_direction" ? "incoming outgoing" : mode === "outbound_only" ? "outgoing" : "incoming")}${mode === "duplicate_message" ? message("msg-1", "incoming") : message("msg-2", "outgoing")}</main>${mode === "more_messages" ? '<b class="more-messages">More</b>' : ""}`,
        });
      return route.abort();
    });
    const calls: string[] = [];
    const browserRequest = async (path: string, body: Record<string, unknown> = {}) => {
      calls.push(path);
      if (path === "/tabs" || path.endsWith("/navigate")) {
        expect(body.trace).toBe(false);
        await page.goto(String(body.url));
        return Response.json({ ok: true, tabId: "synthetic-tab", url: page.url() });
      }
      if (path.endsWith("/evaluate"))
        return Response.json({ ok: true, result: await page.evaluate(String(body.expression)) });
      throw new Error("Unexpected non-read endpoint");
    };
    const reports: Array<{
      messages: Array<Record<string, unknown>>;
      completion?: Record<string, unknown>;
    }> = [];
    const run = {
      kind: "inbox",
      id: randomUUID(),
      leaseId: randomUUID(),
      accountId: randomUUID(),
      accountRef: profile.accountRef,
      channelRef: profile.channelRef,
      inboxSigningKey: Buffer.alloc(32, 8).toString("base64url"),
    };
    const reportInbound = createInboxReporter({
      run,
      assertActive() {},
      async checkEgress() {},
      async request(operation, fields) {
        expect(operation).toBe("inbox-messages");
        const packet = verifyInboxPacket(run.inboxSigningKey, fields.envelope);
        expect(packet.runId).toBe(run.id);
        expect(packet.leaseId).toBe(run.leaseId);
        reports.push({ messages: packet.messages, completion: packet.completion });
        if (mode === "lost_receipt") throw new Error("Lost synthetic response");
        return { receipt: { accepted: packet.messages.length, duplicates: 0, replayed: false } };
      },
    });
    const result = await createFacebookInbox(
      profile,
      browserRequest,
    )({ run, signal: new AbortController().signal, reportInbound });
    const success = ["normal", "empty", "outbound_only"].includes(mode);
    expect(result).toBe(
      success
        ? "completed"
        : mode === "lost_receipt"
          ? "failed"
          : mode === "challenge"
            ? "checkpoint"
            : mode === "login"
              ? "needs_login"
              : mode === "two_factor"
                ? "needs_2fa"
                : "page_contract_failed",
    );
    expect(reports.filter((value) => value.completion)).toHaveLength(success ? 1 : 0);
    if (mode === "normal") {
      expect(reports[0].messages).toHaveLength(1);
      expect(reports[0].messages[0].messageRef).toBe("msg-1");
      expect(reports.at(-1)?.completion?.messageCount).toBe(1);
    }
    if (["empty", "outbound_only"].includes(mode))
      expect(reports.at(-1)?.completion?.messageCount).toBe(0);
    expect(calls.filter((path) => path === "/tabs")).toHaveLength(1);
    expect(calls.some((path) => /click|type|upload/.test(path))).toBe(false);
  });
}
test("inbox profiles require reviewed identity, expiry and stable attribute mappings", () => {
  expect(() =>
    validateInboxProfile({ ...profile, expiresAt: new Date(0).toISOString() }),
  ).toThrow();
  expect(() =>
    validateInboxProfile({ ...profile, identityHref: "https://evil.invalid/x" }),
  ).toThrow();
  expect(() => validateInboxProfile({ ...profile, attributes: {} })).toThrow();
});
