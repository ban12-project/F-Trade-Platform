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
  "loading_then_ready",
  "loading_timeout",
  "loading_abort",
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
    let loadingReads = 0;
    const controller = new AbortController();
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
          body: `${identity}${mode.startsWith("loading_") ? '<b class="loading">Loading</b>' : ""}<main id="inbox">${mode === "empty" ? '<p class="empty">Empty</p>' : `<a class="thread" data-thread-id="thread-1" href="https://www.facebook.com/messages/t/thread-1">Thread</a>`}${mode === "changed_list" && listReads > 1 ? '<a class="thread" data-thread-id="thread-2" href="https://www.facebook.com/messages/t/thread-2">New</a>' : ""}</main>${mode === "more_threads" ? '<b class="more-threads">More</b>' : ""}${mode === "challenge" ? '<b class="challenge">Challenge</b>' : ""}${mode === "login" ? '<b class="login">Login</b>' : ""}${mode === "two_factor" ? '<b class="two-factor">2FA</b>' : ""}`,
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
      if (path.endsWith("/evaluate")) {
        if (await page.locator(".loading").count()) {
          loadingReads++;
          if (mode === "loading_then_ready" && loadingReads % 2 === 0)
            await page.locator(".loading").evaluate((element) => element.remove());
        }
        const result = await page.evaluate(String(body.expression));
        if (mode === "loading_abort") controller.abort();
        return Response.json({ ok: true, result });
      }
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
    )({ run, signal: controller.signal, reportInbound });
    const success = ["normal", "empty", "outbound_only", "loading_then_ready"].includes(mode);
    expect(result).toBe(
      success
        ? "completed"
        : ["lost_receipt", "changed_list", "loading_timeout", "loading_abort"].includes(mode)
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
    if (mode === "loading_timeout") {
      expect(loadingReads).toBe(9);
      expect(reports).toHaveLength(0);
      expect(calls.some((path) => path.endsWith("/navigate"))).toBe(false);
    }
    if (mode === "loading_abort") {
      expect(loadingReads).toBe(1);
      expect(reports).toHaveLength(0);
    }
    if (mode === "loading_then_ready") {
      expect(loadingReads).toBe(4);
      expect(reports[0].messages[0].messageRef).toBe("msg-1");
    }
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
  for (const pagination of [
    null,
    [],
    { other: {} },
    { list: { container: "#inbox", start: ".start" } },
    { thread: { container: "#thread", start: ".start", end: ".end,button" } },
  ])
    expect(() => validateInboxProfile({ ...profile, pagination })).toThrow(
      "inbox_pagination_invalid",
    );
});

for (const mode of [
  "normal",
  "missing_start",
  "page_limit",
  "missing_end",
  "gap",
  "conflict",
  "abort",
  "changed_before_scroll",
] as const) {
  test(`reviewed inbox pagination ${mode}`, async ({ page, context }) => {
    const pagedProfile = {
      ...profile,
      pagination: {
        list: { container: "#inbox", start: ".start", end: ".end" },
        thread: { container: "#thread", start: ".start", end: ".end" },
      },
    };
    const controller = new AbortController();
    let advances = 0;
    const time = new Date(Date.now() - 2000).toISOString();
    await context.route("**/*", async (route) => {
      const isList = route.request().url() === profile.url;
      const id = route.request().url().split("/").at(-1);
      const records = isList
        ? Array.from(
            { length: mode === "page_limit" ? 100 : 4 },
            (_, i) =>
              `<a class="thread record" data-thread-id="thread-${i}" href="https://www.facebook.com/messages/t/thread-${i}">Thread ${i}</a>`,
          ).join("")
        : Array.from(
            { length: 5 },
            (_, i) =>
              `<div class="message incoming record" data-message-id="msg-${id}-${i}"><p class="body">SYNTHETIC ${i}</p><time datetime="${time}">Time</time></div>`,
          ).join("");
      await route.fulfill({
        contentType: "text/html",
        body: `<style>#inbox,#thread{height:220px;overflow-y:auto}.record{display:block;height:100px;margin:0}p{margin:0}.start,.end{height:20px}</style><a id="identity" href="${profile.identityHref}">Identity</a><main id="${isList ? "inbox" : "thread"}">${isList ? (mode === "missing_start" ? "" : '<div class="start">Start</div>') : `<h1 data-thread-id="${id}">Thread</h1><div class="end">End</div>`}${records}${isList ? (mode === "missing_end" ? "" : '<div class="end">End</div>') : '<div class="start">Start</div>'}</main>`,
      });
    });
    const reports: Array<{
      messages: Array<Record<string, unknown>>;
      completion?: Record<string, unknown>;
    }> = [];
    const request = async (path: string, body: Record<string, unknown> = {}) => {
      if (path === "/tabs" || path.endsWith("/navigate")) {
        await page.goto(String(body.url));
        if (String(body.url) !== profile.url)
          await page.locator("#thread").evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
        return Response.json({ ok: true, tabId: "paged-tab", url: page.url() });
      }
      expect(path.endsWith("/evaluate")).toBe(true);
      // The fourth argument carries the previously observed cursor only on a scroll.
      const expression = String(body.expression);
      const isAdvance = /,\{"ids":\[/.test(expression);
      if (isAdvance) {
        advances++;
        if (mode === "changed_before_scroll")
          await page
            .locator("a.thread")
            .first()
            .evaluate((element) => {
              element.setAttribute("data-thread-id", "changed");
              (element as HTMLAnchorElement).href = "https://www.facebook.com/messages/t/changed";
            });
      }
      const result = await page.evaluate(expression);
      if (isAdvance && mode === "gap")
        await page.locator("#inbox").evaluate((element) => {
          element.querySelectorAll("a").forEach((link, index) => {
            link.setAttribute("data-thread-id", `replacement-${index}`);
            link.href = `https://www.facebook.com/messages/t/replacement-${index}`;
          });
        });
      if (isAdvance && mode === "conflict" && String(body.expression).includes('"thread",'))
        await page.locator(".body").evaluateAll((elements) => {
          for (const element of elements) element.textContent = "SYNTHETIC edited";
        });
      if (isAdvance && mode === "abort") controller.abort();
      return Response.json({ ok: true, result });
    };
    const outcome = await createFacebookInbox(
      pagedProfile,
      request,
    )({
      run: {
        kind: "inbox",
        id: randomUUID(),
        accountId: randomUUID(),
        accountRef: profile.accountRef,
        channelRef: profile.channelRef,
      },
      signal: controller.signal,
      async reportInbound(messages, _observedAt, completion) {
        reports.push({ messages, completion });
      },
    });
    expect(outcome).toBe(
      mode === "normal"
        ? "completed"
        : ["missing_end", "abort", "changed_before_scroll"].includes(mode)
          ? "failed"
          : "page_contract_failed",
    );
    expect(reports.filter((report) => report.completion)).toHaveLength(mode === "normal" ? 1 : 0);
    if (mode === "normal") {
      expect(advances).toBeGreaterThan(8);
      const messages = reports.flatMap((report) => report.messages);
      expect(messages).toHaveLength(20);
      expect(reports.filter((report) => !report.completion)).toHaveLength(10);
      expect(new Set(messages.map((message) => message.messageRef)).size).toBe(20);
      expect(reports.at(-1)?.completion).toMatchObject({
        conversationCount: 4,
        messageCount: 20,
        coverage: "visible_inbox",
      });
    }
    if (mode === "missing_start") expect(advances).toBe(0);
    if (mode === "page_limit") expect(advances).toBe(39);
    if (mode === "changed_before_scroll" || mode === "abort") expect(advances).toBe(1);
  });
}
