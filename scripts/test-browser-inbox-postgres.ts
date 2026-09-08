import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { POST } from "../app/api/browser-nodes/route";
import { signInboxPacket } from "../lib/browser-fleet/inbox-protocol";
import { handleBrowserNodeRequest } from "../lib/browser-fleet/store";
import type { Database } from "../lib/db/client";
import { socialMessage } from "../lib/db/schema";

export async function testBrowserInbox(
  database: Database,
  node: { nodeId: string; accessKey: string },
  identity: { installationId: string; bootId: string },
) {
  process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  await database.execute(
    sql`UPDATE browser_fleet_node SET document = jsonb_set(document, '{accounts,0,pollSeconds}', '900'::jsonb) WHERE id = ${node.nodeId}`,
  );
  await handleBrowserNodeRequest(node.accessKey, {
    ...identity,
    operation: "recover",
    stoppedRunIds: [],
    capabilities: ["interactive", "inbox"],
  });
  const claim = await handleBrowserNodeRequest(node.accessKey, {
    ...identity,
    operation: "claim",
    requestId: randomUUID(),
    availableMemoryMb: 4096,
    localSlots: 1,
  });
  const run = claim.run as { id: string; leaseId: string; inboxSigningKey: string };
  assert.ok(run?.inboxSigningKey);
  const messageRef = randomUUID();
  const packet = {
    runId: run.id,
    leaseId: run.leaseId,
    requestId: randomUUID(),
    observedAt: new Date().toISOString(),
    messages: [
      {
        conversationRef: randomUUID(),
        messageRef,
        direction: "inbound",
        identityQuality: "dom_id",
        body: "SYNTHETIC signed inbox",
        receivedAt: new Date(Date.now() - 1000).toISOString(),
      },
    ],
  };
  const envelope = signInboxPacket(run.inboxSigningKey, packet);
  const request = {
    ...identity,
    operation: "inbox-messages",
    runId: run.id,
    leaseId: run.leaseId,
    envelope,
  };
  await assert.rejects(handleBrowserNodeRequest(node.accessKey, request), /inbox_lease_inactive/);
  await handleBrowserNodeRequest(node.accessKey, {
    ...identity,
    operation: "heartbeat",
    runId: run.id,
    leaseId: run.leaseId,
    ready: true,
  });
  await assert.rejects(
    handleBrowserNodeRequest(node.accessKey, {
      ...request,
      envelope: signInboxPacket(Buffer.alloc(32, 4).toString("base64url"), packet),
    }),
    /inbox_signature_invalid/,
  );
  await assert.rejects(
    handleBrowserNodeRequest(node.accessKey, {
      ...request,
      envelope: signInboxPacket(run.inboxSigningKey, { ...packet, leaseId: randomUUID() }),
    }),
    /inbox_scope_invalid/,
  );
  await assert.rejects(
    handleBrowserNodeRequest(node.accessKey, {
      ...request,
      envelope: signInboxPacket(run.inboxSigningKey, {
        ...packet,
        observedAt: new Date(Date.now() - 301000).toISOString(),
      }),
    }),
    /inbox_packet_expired/,
  );
  process.env.BROWSER_FLEET_ENABLED = "1";
  const http = (body: unknown, key = node.accessKey) =>
    POST(
      new Request("https://synthetic.invalid/api/browser-nodes", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await http(request, "invalid")).status, 401);
  assert.equal((await http({ ...request, padding: "x".repeat(262144) })).status, 413);
  const transport = await http(request);
  assert.equal(transport.status, 200);
  assert.equal(transport.headers.get("cache-control"), "no-store");
  assert.deepEqual((await transport.json()).receipt, {
    accepted: 1,
    duplicates: 0,
    replayed: false,
  });
  const results = await Promise.all([
    handleBrowserNodeRequest(node.accessKey, request),
    handleBrowserNodeRequest(node.accessKey, request),
  ]);
  assert.deepEqual(
    results
      .map((value) => value.receipt)
      .sort(
        (a, b) =>
          Number((a as { replayed: boolean }).replayed) -
          Number((b as { replayed: boolean }).replayed),
      ),
    [
      { accepted: 1, duplicates: 0, replayed: true },
      { accepted: 1, duplicates: 0, replayed: true },
    ],
  );
  await assert.rejects(
    handleBrowserNodeRequest(node.accessKey, {
      ...request,
      envelope: signInboxPacket(run.inboxSigningKey, {
        ...packet,
        messages: [{ ...packet.messages[0], body: "SYNTHETIC altered request" }],
      }),
    }),
    /inbox_request_conflict/,
  );
  assert.equal(
    (
      await database
        .select()
        .from(socialMessage)
        .where(eq(socialMessage.externalMessageRef, messageRef))
    ).length,
    1,
  );
  await handleBrowserNodeRequest(node.accessKey, {
    ...identity,
    operation: "finish",
    runId: run.id,
    leaseId: run.leaseId,
    outcome: "completed",
    stopped: true,
  });
  await assert.rejects(handleBrowserNodeRequest(node.accessKey, request), /inbox_lease_inactive/);
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
    "PASS inbox broker signing, lease scope, expiry, concurrent replay and conflicting request rejection",
  );
}
