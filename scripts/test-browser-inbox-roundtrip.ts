/** Synthetic Chromium -> real loopback HTTP -> production Route Handler -> PostgreSQL.
 * Camofox REST calls are bridged to Chromium; no real Facebook or Camofox runtime. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { POST } from "../app/api/browser-nodes/route";
import { handleBrowserNodeRequest } from "../lib/browser-fleet/store";
import type { Database } from "../lib/db/client";
import { aggregateRecord, socialConversation, socialMessage } from "../lib/db/schema";
import { routeInboundConversation } from "../lib/social/inbound-routing-store";
import { decryptSocialMessageBody } from "../lib/social/message-crypto";
import { createFacebookInbox } from "../ops/browser-node/facebook-inbox.mjs";
import { createInboxReporter } from "../ops/browser-node/inbox.mjs";

export async function testInboxRoundTrip(
  database: Database,
  node: { nodeId: string; accessKey: string },
  identity: { installationId: string; bootId: string },
  actorId: string,
) {
  const threadRef = randomUUID(),
    messageRef = randomUUID();
  const body = "SYNTHETIC complete incoming inquiry";
  const receivedAt = new Date(Date.now() - 2000).toISOString();
  let dropResponse = true;
  let deliveredBatches = 0;
  const diagnostic: string[] = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const payload = Buffer.concat(chunks).toString("utf8");
      const input = JSON.parse(payload);
      const response = await POST(
        new Request("http://127.0.0.1/api/browser-nodes", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: String(incoming.headers.authorization ?? ""),
          },
          body: payload,
        }),
      );
      if (
        response.ok &&
        input.operation === "inbox-messages" &&
        input.envelope.packet.messages.length
      ) {
        deliveredBatches++;
        if (dropResponse) {
          dropResponse = false;
          await response.body?.cancel();
          outgoing.destroy(); // Commit succeeded, but the worker never sees its receipt.
          return;
        }
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500);
      outgoing.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/browser-nodes`;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    await handleBrowserNodeRequest(node.accessKey, {
      ...identity,
      operation: "recover",
      stoppedRunIds: [],
      capabilities: ["interactive", "inbox"],
    });
    for (const attempt of [0, 1]) {
      await database.execute(
        sql`UPDATE browser_fleet_node SET document = jsonb_set(jsonb_set(document, '{accounts,0,pollSeconds}', '900'::jsonb), '{accounts,0,nextPollAt}', '0'::jsonb) WHERE id = ${node.nodeId}`,
      );
      const before = await database.execute(
        sql`SELECT document FROM browser_fleet_node WHERE id = ${node.nodeId}`,
      );
      const beforeState = before.rows[0].document as {
        accounts: Array<{ lastCheckedAt: number | null }>;
      };
      const claim = await handleBrowserNodeRequest(node.accessKey, {
        ...identity,
        operation: "claim",
        requestId: randomUUID(),
        availableMemoryMb: 4096,
        localSlots: 1,
      });
      const run = claim.run as {
        id: string;
        leaseId: string;
        kind: string;
        accountId: string;
        channelRef: string;
        accountRef: string;
        inboxSigningKey: string;
      };
      assert.ok(run?.inboxSigningKey);
      await handleBrowserNodeRequest(node.accessKey, {
        ...identity,
        operation: "heartbeat",
        runId: run.id,
        leaseId: run.leaseId,
        ready: true,
      });
      const profile = {
        version: 1,
        accountRef: run.accountRef,
        channelRef: run.channelRef,
        reviewRef: "evidence-synthetic-roundtrip",
        reviewedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
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
      const context: BrowserContext = await browser.newContext();
      try {
        await context.route("**/*", (route) => {
          const target = route.request().url();
          const owner = `<a id="identity" href="${profile.identityHref}">Synthetic owner</a>`;
          if (target === profile.url)
            return route.fulfill({
              contentType: "text/html",
              body: `${owner}<main id="inbox"><a class="thread" data-thread-id="${threadRef}" href="https://www.facebook.com/messages/t/${threadRef}">Synthetic thread</a></main>`,
            });
          if (target === `https://www.facebook.com/messages/t/${threadRef}`)
            return route.fulfill({
              contentType: "text/html",
              body: `${owner}<main id="thread"><h1 data-thread-id="${threadRef}">Thread</h1><section class="message incoming" data-message-id="${messageRef}"><p class="body">${body}</p><time datetime="${receivedAt}">Time</time></section></main>`,
            });
          return route.abort();
        });
        const page: Page = await context.newPage();
        const browserRequest = async (
          path: string,
          value: Record<string, unknown> = {},
        ): Promise<Response> => {
          if (path === "/tabs" || path.endsWith("/navigate")) {
            await page.goto(String(value.url));
            return Response.json({ ok: true, tabId: "synthetic-tab", url: page.url() });
          }
          if (path.endsWith("/evaluate"))
            return Response.json({
              ok: true,
              result: await page.evaluate(String(value.expression)).catch((error) => {
                diagnostic.push(String(error.message).slice(0, 250));
                throw error;
              }),
            });
          throw new Error("unexpected_browser_write");
        };
        const receipts: Array<{ accepted: number; duplicates: number; replayed: boolean }> = [];
        const report = createInboxReporter({
          run,
          assertActive() {},
          async checkEgress() {},
          async request(operation, fields) {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${node.accessKey}`,
              },
              body: JSON.stringify({ ...identity, operation, ...fields }),
              signal: AbortSignal.timeout(5000),
            });
            assert.equal(response.status, 200);
            const result = await response.json();
            receipts.push(result.receipt);
            return result;
          },
        });
        const outcome = await createFacebookInbox(
          profile,
          browserRequest,
        )({ run, signal: new AbortController().signal, reportInbound: report });
        assert.equal(outcome, attempt === 0 ? "failed" : "completed");
        assert.equal(
          deliveredBatches,
          attempt + 1,
          `Lost response must not trigger another send in the same run; ${diagnostic.join(" | ")}`,
        );
        if (attempt === 0) assert.equal(receipts.length, 0);
        else
          assert.deepEqual(receipts, [
            { accepted: 0, duplicates: 1, replayed: false },
            { accepted: 0, duplicates: 0, replayed: false },
          ]);
        await handleBrowserNodeRequest(node.accessKey, {
          ...identity,
          operation: "finish",
          runId: run.id,
          leaseId: run.leaseId,
          outcome,
          stopped: true,
        });
        const after = await database.execute(
          sql`SELECT document FROM browser_fleet_node WHERE id = ${node.nodeId}`,
        );
        const state = after.rows[0].document as typeof beforeState;
        if (attempt === 0)
          assert.equal(state.accounts[0].lastCheckedAt, beforeState.accounts[0].lastCheckedAt);
        else
          assert.ok(
            (state.accounts[0].lastCheckedAt ?? 0) > (beforeState.accounts[0].lastCheckedAt ?? 0),
          );
        assert.equal(JSON.stringify(after.rows).includes(body), false);
      } finally {
        await context.close();
      }
    }
    const messages = await database
      .select()
      .from(socialMessage)
      .where(eq(socialMessage.externalMessageRef, messageRef));
    assert.equal(messages.length, 1);
    assert.equal(decryptSocialMessageBody(messages[0].bodyCiphertext), body);
    const [conversation] = await database
      .select()
      .from(socialConversation)
      .where(eq(socialConversation.id, messages[0].conversationId));
    assert.equal(conversation.leadId, null);
    const routed = await routeInboundConversation(
      { conversationId: conversation.id, mode: "create" },
      actorId,
      database,
    );
    const [lead] = await database
      .select()
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, routed.leadId));
    assert.equal(lead.state, "LEAD_RECEIVED");
    assert.equal(lead.payload.next_action, "collect_rfq");
    await assert.rejects(
      routeInboundConversation(
        { conversationId: conversation.id, mode: "create" },
        actorId,
        database,
      ),
      /已完成分流/,
    );
    await database.execute(
      sql`UPDATE browser_fleet_node SET document = jsonb_set(document, '{accounts,0,pollSeconds}', '0'::jsonb) WHERE id = ${node.nodeId}`,
    );
    await handleBrowserNodeRequest(node.accessKey, {
      ...identity,
      operation: "recover",
      stoppedRunIds: [],
      capabilities: ["interactive", "publish"],
    });
    console.log(
      "PASS Chromium collector -> signed loopback HTTP -> PostgreSQL -> human routing; lost receipt deduplicates on next run",
    );
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
