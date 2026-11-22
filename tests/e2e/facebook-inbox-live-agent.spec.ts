import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { verifyInboxPacket } from "../../lib/browser-fleet/inbox-protocol";
import {
  createFacebookLiveInboxAgent,
  validateLiveInboxProfile,
} from "../../ops/browser-node/facebook-inbox-agent.mjs";
import { createInboxReporter } from "../../ops/browser-node/inbox.mjs";

const OWNER_ID = "61589008383902";
const REAL_CAPTURED_SNOWFLAKE = "7530124870827423183"; // 2026-11-22T04:27:52.160Z

const baseProfile = {
  version: 2,
  mode: "facebook-live-agent",
  accountRef: "account-ref-a",
  channelRef: "facebook-personal",
  expectedAccountRef: OWNER_ID,
  reviewRef: "evidence-synthetic-live-inbox",
  reviewedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  url: "https://www.facebook.com/messages/",
};

function currentUserJson(uid: string) {
  return `<script type="application/json">${JSON.stringify([
    ["CurrentUserInitialData", [], { USER_ID: uid, ACCOUNT_ID: uid }],
  ])}</script>`;
}

for (const mode of [
  "normal",
  "empty_inbox",
  "wrong_identity",
  "ambiguous_direction",
  "login",
  "two_factor",
  "checkpoint",
  "unauthorized_click",
  "premature_finish",
  "changed_list",
  "no_progress_loop",
] as const) {
  test(`live inbox Browser Agent collector ${mode}`, async ({ page, context }) => {
    let listReads = 0;
    const seenIds = new Set<string>();
    const recentMs = Date.now() - 120_000;
    const shift = BigInt(22);
    const recentSnowflakeOut = (BigInt(recentMs - 60_000) << shift).toString();
    const recentSnowflakeIn = ((BigInt(recentMs) << shift) | BigInt(98765)).toString();
    const recentSnowflakeMedia = ((BigInt(recentMs + 1000) << shift) | BigInt(54321)).toString();
    const expectedSnowflakeIso = new Date(recentMs).toISOString();
    const recentTime = new Date(Date.now() - 5000).toISOString();

    await context.route("**/*", (route) => {
      const url = route.request().url();
      const parsed = new URL(url);

      if (mode === "login" && parsed.pathname === "/messages/") {
        return route.fulfill({
          contentType: "text/html",
          body: `${currentUserJson("0")}<form action="https://www.facebook.com/login.php" method="post"><input type="password" name="pass"></form>`,
        });
      }
      if (mode === "two_factor" && parsed.pathname === "/messages/") {
        return route.fulfill({
          status: 302,
          headers: { location: "https://www.facebook.com/two_step_verification/two_factor/" },
        });
      }
      if (parsed.pathname === "/two_step_verification/two_factor/") {
        return route.fulfill({ contentType: "text/html", body: `<main>2FA required</main>` });
      }
      if (mode === "checkpoint" && parsed.pathname === "/messages/") {
        return route.fulfill({
          status: 302,
          headers: { location: "https://www.facebook.com/checkpoint/123456/" },
        });
      }
      if (parsed.pathname === "/checkpoint/123456/") {
        return route.fulfill({ contentType: "text/html", body: `<main>Checkpoint</main>` });
      }

      if (parsed.pathname === "/messages/") {
        listReads++;
        const identity = currentUserJson(mode === "wrong_identity" ? "99999999999999" : OWNER_ID);
        if (mode === "empty_inbox") {
          return route.fulfill({
            contentType: "text/html",
            body: `${identity}<div role="tabpanel" aria-label="All chats"><p>No chats</p></div>`,
          });
        }
        const extraChangedRow =
          mode === "changed_list" && listReads > 1
            ? `<div role="row"><div role="gridcell"><a role="link" href="https://www.facebook.com/messages/e2ee/t/999999/">New Chat</a></div></div>`
            : "";
        const secondRow =
          mode === "normal"
            ? `<div role="row"><div role="gridcell"><a role="link" href="https://www.facebook.com/messages/t/thread-legacy-url/">Legacy URL Chat</a></div></div>`
            : "";
        return route.fulfill({
          contentType: "text/html",
          body: `${identity}<div role="tabpanel" aria-label="All chats"><div role="grid" aria-label="Chats"><div role="row"><div role="gridcell"><a role="link" href="https://www.facebook.com/messages/e2ee/t/1618185166252064/">Phillips Chelsea</a></div></div>${secondRow}${extraChangedRow}</div></div>`,
        });
      }

      if (parsed.pathname === "/messages/e2ee/t/1618185166252064/") {
        const directionRow =
          mode === "ambiguous_direction"
            ? `<div data-scope="messages_table" data-message-id="61588876867341@msgr.${recentSnowflakeIn}"><div dir="auto">Ambiguous row</div></div>`
            : `<div data-scope="messages_table" data-message-id="61588876867341@msgr.${recentSnowflakeIn}" aria-label="At 5:27 AM, Phillips: Hi, test reply 1122-B2A"><h4>Phillips</h4><div dir="auto"><span>Hi, test reply 1122-B2A</span></div><div role="toolbar" aria-label="Message actions"></div></div>`;
        const nonTextBubble = `<div data-scope="messages_table" data-message-id="61588876867341@msgr.${recentSnowflakeMedia}" aria-label="At 5:28 AM, Phillips sent a photo."><h4>Phillips</h4><img alt="photo" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div>`;
        return route.fulfill({
          contentType: "text/html",
          body: `${currentUserJson(OWNER_ID)}<div role="main"><div role="log" aria-label="Messages in conversation with Phillips Chelsea"><div data-scope="messages_table" data-message-id="61588876867341@msgr.${recentSnowflakeOut}" aria-label="At 5:07 AM, You: Hi, test ping 1122-A2B"><h4>You sent</h4><div dir="auto"><span>Hi, test ping 1122-A2B</span></div></div>${directionRow}${nonTextBubble}</div></div>`,
        });
      }

      if (parsed.pathname === "/messages/t/thread-legacy-url/") {
        return route.fulfill({
          contentType: "text/html",
          body: `${currentUserJson(OWNER_ID)}<div role="main"><div role="log" aria-label="Messages in conversation with Buyer Two"><div data-scope="messages_table" data-message-id="msg-legacy-1" aria-label="At 6:00 AM, Buyer: Need clutch quote"><h4>Buyer</h4><div dir="auto">Need clutch quote</div><time datetime="${recentTime}"></time></div></div></div>`,
        });
      }

      return route.abort();
    });

    const browserRequest = async (path: string, body: Record<string, unknown> = {}) => {
      if (path === "/tabs" || path.endsWith("/navigate")) {
        expect(body.trace).toBe(false);
        await page.goto(String(body.url));
        return Response.json({ ok: true, tabId: "live-tab", url: page.url() });
      }
      if (path.includes("/snapshot")) {
        const snapshot = await page.locator("body").ariaSnapshot();
        return Response.json({
          ok: true,
          url: page.url(),
          snapshot,
          truncated: false,
          hasMore: false,
        });
      }
      if (path.endsWith("/evaluate")) {
        const result = await page.evaluate(String(body.expression));
        return Response.json({ ok: true, result });
      }
      throw new Error(`Unexpected non-read endpoint: ${path}`);
    };

    const reports: Array<{
      messages: Array<Record<string, unknown>>;
      completion?: Record<string, unknown>;
    }> = [];
    const seenAriaSnapshots: string[] = [];

    const decideInboxAction = async ({
      snapshot,
    }: {
      snapshot: { controls: Array<{ id: string }>; state: string };
    }) => {
      const state = JSON.parse(snapshot.state) as {
        remainingHandles: string[];
        finalListRechecked: boolean;
        ariaExcerpt: string;
      };
      seenAriaSnapshots.push(state.ariaExcerpt);

      if (mode === "unauthorized_click") {
        return { command: { action: "click", target: "thread-0", valueRef: "" } };
      }
      if (mode === "premature_finish") {
        return { command: { action: "finish", target: "", valueRef: "" } };
      }
      if (mode === "no_progress_loop") {
        return { command: { action: "read", target: "", valueRef: "" } };
      }
      if (state.remainingHandles.length > 0) {
        return {
          command: { action: "navigate", target: state.remainingHandles[0], valueRef: "" },
        };
      }
      if (!state.finalListRechecked) {
        return { command: { action: "navigate", target: "inbox-home", valueRef: "" } };
      }
      return { command: { action: "finish", target: "", valueRef: "" } };
    };

    const run = {
      kind: "inbox",
      id: randomUUID(),
      leaseId: randomUUID(),
      accountId: randomUUID(),
      accountRef: baseProfile.accountRef,
      channelRef: baseProfile.channelRef,
      inboxSigningKey: Buffer.alloc(32, 9).toString("base64url"),
    };

    const makeReporter = () =>
      createInboxReporter({
        run,
        assertActive() {},
        async checkEgress() {},
        async request(operation, fields) {
          expect(operation).toBe("inbox-messages");
          const packet = verifyInboxPacket(run.inboxSigningKey, fields.envelope);
          let accepted = 0;
          let duplicates = 0;
          for (const msg of packet.messages) {
            if (seenIds.has(msg.messageRef)) duplicates++;
            else {
              seenIds.add(msg.messageRef);
              accepted++;
            }
          }
          reports.push({ messages: packet.messages, completion: packet.completion });
          return { receipt: { accepted, duplicates, replayed: false } };
        },
      });

    const controller = new AbortController();
    const outcome = await createFacebookLiveInboxAgent(
      baseProfile,
      browserRequest,
      decideInboxAction,
    )({ run, signal: controller.signal, reportInbound: makeReporter() });

    const expectedOutcome =
      mode === "normal" || mode === "empty_inbox"
        ? "completed"
        : mode === "wrong_identity" || mode === "ambiguous_direction"
          ? "page_contract_failed"
          : mode === "login"
            ? "needs_login"
            : mode === "two_factor"
              ? "needs_2fa"
              : mode === "checkpoint"
                ? "checkpoint"
                : "failed";

    expect(outcome).toBe(expectedOutcome);

    if (mode === "normal") {
      expect(seenAriaSnapshots.length).toBe(4);
      expect(seenAriaSnapshots[0]).toContain("grid");
      expect(reports).toHaveLength(2);
      const msgs = reports[0].messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toMatchObject({
        conversationRef: "1618185166252064",
        messageRef: `61588876867341@msgr.${recentSnowflakeIn}`,
        direction: "inbound",
        identityQuality: "dom_id",
        body: "Hi, test reply 1122-B2A",
        receivedAt: expectedSnowflakeIso,
      });
      expect(msgs[1]).toMatchObject({
        conversationRef: "thread-legacy-url",
        messageRef: "msg-legacy-1",
        body: "Need clutch quote",
      });
      expect(reports[1].completion).toMatchObject({
        conversationCount: 2,
        messageCount: 2,
        coverage: "visible_inbox",
      });

      // Repeat poll must classify all messages as duplicates (zero duplicate rows ingested).
      const secondOutcome = await createFacebookLiveInboxAgent(
        baseProfile,
        browserRequest,
        decideInboxAction,
      )({ run, signal: controller.signal, reportInbound: makeReporter() });
      expect(secondOutcome).toBe("completed");
      expect(seenIds.size).toBe(2);
    } else if (mode === "empty_inbox") {
      expect(reports).toHaveLength(1);
      expect(reports[0].completion).toMatchObject({
        conversationCount: 0,
        messageCount: 0,
      });
    } else {
      expect(reports.filter((entry) => entry.completion)).toHaveLength(0);
    }
  });
}

test("live inbox profile validator enforces version 2, numeric expectedAccountRef, and /messages/ origin", () => {
  expect(new Date(Number(BigInt(REAL_CAPTURED_SNOWFLAKE) >> BigInt(22))).toISOString()).toBe(
    "2026-11-22T04:27:52.160Z",
  );
  expect(() => validateLiveInboxProfile({ ...baseProfile, version: 1 })).toThrow(
    "inbox_profile_invalid",
  );
  expect(() =>
    validateLiveInboxProfile({ ...baseProfile, expectedAccountRef: "not-numeric" }),
  ).toThrow("inbox_profile_invalid");
  expect(() =>
    validateLiveInboxProfile({ ...baseProfile, url: "https://evil.invalid/messages/" }),
  ).toThrow("inbox_profile_origin_invalid");
});
