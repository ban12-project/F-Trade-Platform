/** Synthetic, migrated PostgreSQL regression for claim -> signed authorization.
 * No browser, Facebook account, or blob/network delivery is used. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { handleBrowserNodeRequest, ownerBrowserCommand } from "../lib/browser-fleet/store";
import { closeDatabase, type Database } from "../lib/db/client";
import { facebookPublicationManifest } from "../lib/db/facebook-runtime-schema";
import { productMediaAsset } from "../lib/db/product-media-schema";
import * as schema from "../lib/db/schema";
import { authorizeFacebookPublication } from "../lib/social/facebook-media-store";
import { claimNextSocialWorkerJob } from "../lib/social/job-store";
import {
  listProjectPublicationData,
  recordControlledPublicationResult,
  submitControlledPublication,
} from "../lib/social/publication-store";
import { digestSocialWorkerPayload } from "../lib/social/worker-protocol";

import { testFacebookInbound } from "./test-facebook-inbound-postgres";

async function main() {
  const connectionString = process.env.FACEBOOK_PUBLICATION_TEST_DATABASE_URL;
  assert.ok(connectionString, "Dedicated synthetic database required");
  const address = new URL(connectionString);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(address.hostname));
  assert.equal(address.pathname, "/facebook_publication_test");
  process.env.DATABASE_URL = connectionString;
  process.env.DATABASE_TRANSPORT = "postgres";
  process.env.FACEBOOK_CREDENTIAL_ACTIVE_KEY_ID = "synthetic";
  process.env.FACEBOOK_CREDENTIAL_KEYS_JSON = JSON.stringify({
    synthetic: Buffer.alloc(32, 3).toString("base64"),
  });
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  const database = db as unknown as Database;
  const now = new Date();
  const actor = randomUUID();
  const projectId = randomUUID();
  const channelRef = randomUUID();
  let accountRef = randomUUID();
  const workerId = randomUUID();
  process.env.SOCIAL_WORKER_ID = workerId;
  process.env.SOCIAL_WORKER_CHANNEL_REF = channelRef;
  process.env.SOCIAL_WORKER_ACCOUNT_REF = accountRef;
  process.env.SOCIAL_WORKER_SIGNING_KEY = Buffer.alloc(32, 7).toString("base64");

  async function fixture(format = "text", jobAccount = accountRef, stalePreview = false) {
    const contentRef = randomUUID();
    const id = randomUUID();
    const jobId = randomUUID();
    await db.insert(schema.aggregateRecord).values({
      id: contentRef,
      type: "content",
      state: "CONTENT_APPROVED",
      payload: { body: "SYNTHETIC review fixture; no product claims.", status: "approved" },
      createdByType: "human",
      createdById: actor,
    });
    await db.insert(schema.workspaceProjectItem).values({
      id: randomUUID(),
      projectId,
      aggregateId: contentRef,
      role: "marketing_content",
    });
    await db.insert(schema.approval).values({
      id: randomUUID(),
      aggregateId: contentRef,
      gate: "gate_01_truth",
      status: "approved",
      requestedByType: "human",
      requestedById: actor,
      requestedAt: now,
      decidedByType: "human",
      decidedById: actor,
      decidedAt: now,
      evidenceRef: "synthetic-review",
    });
    if (format === "text" && jobAccount === accountRef) {
      if (stalePreview) {
        const oldPreview = (await listProjectPublicationData(projectId, database)).candidates.find(
          (item) => item.id === contentRef,
        );
        assert.ok(oldPreview);
        await db
          .update(schema.aggregateRecord)
          .set({ version: 2 })
          .where(eq(schema.aggregateRecord.id, contentRef));
        await assert.rejects(
          submitControlledPublication(
            {
              projectId,
              contentRef,
              format,
              channelRef,
              accountRef,
              previewDigest: oldPreview.previewDigest,
              confirmationRef: `evidence-stale-${randomUUID()}`,
            },
            actor,
            database,
          ),
          /内容已更新/,
        );
        assert.equal(
          (
            await db
              .select()
              .from(schema.socialPublication)
              .where(eq(schema.socialPublication.contentRef, contentRef))
          ).length,
          0,
        );
      }

      const saved = await submitControlledPublication(
        {
          projectId,
          contentRef,
          format,
          channelRef,
          accountRef,
          previewDigest: (await listProjectPublicationData(projectId, database)).candidates.find(
            (item) => item.id === contentRef,
          )?.previewDigest,
          confirmationRef: `evidence-synthetic-${randomUUID()}`,
        },
        actor,
        database,
      );
      assert.ok(saved.browserJobId);
      assert.equal(saved.textConfirmation?.contentVersion, stalePreview ? 2 : 1);
      return { id: saved.id, jobId: saved.browserJobId, contentRef };
    }
    await db.insert(schema.socialBrowserJob).values({
      id: jobId,
      channelRef,
      accountRef: jobAccount,
      kind: "publish",
      idempotencyKey: randomUUID(),
      payloadRef: id,
    });
    await db.insert(schema.socialPublication).values({
      id,
      projectId,
      channelRef,
      accountRef: jobAccount,
      contentRef,
      format,
      confirmationRef: "synthetic-confirmation",
      browserJobId: jobId,
      status: "submitted",
    });
    return { id, jobId, contentRef };
  }
  async function imageFixture() {
    const f = await fixture("image");
    const productId = randomUUID();
    const evidenceId = randomUUID();
    const mediaId = randomUUID();
    const caption = "SYNTHETIC image review fixture; no product claims.";
    const sha256 = createHash("sha256").update(evidenceId).digest("hex");
    await db.insert(schema.aggregateRecord).values({
      id: productId,
      type: "product",
      state: "PRODUCT_READY",
      payload: { synthetic: true },
      createdByType: "human",
      createdById: actor,
    });
    await db
      .update(schema.aggregateRecord)
      .set({ payload: { body: caption, product_id: productId } })
      .where(eq(schema.aggregateRecord.id, f.contentRef));
    await db.insert(schema.evidence).values({
      id: evidenceId,
      classification: "internal",
      blobKey: `synthetic/${evidenceId}`,
      contentType: "image/png",
      sha256,
      sizeBytes: 100,
      sourceLabel: "SYNTHETIC ONLY",
      uploadedByType: "human",
      uploadedById: actor,
    });
    await db.insert(productMediaAsset).values({
      id: mediaId,
      productId,
      evidenceId,
      origin: "user_upload",
      mediaType: "image",
      role: "product_hero",
      contentType: "image/png",
      width: 10,
      height: 10,
      rightsEvidenceRef: evidenceId,
      publicDistributionAllowed: true,
      reviewStatus: "approved",
      reviewedBy: actor,
      reviewedAt: now,
      reviewEvidenceRef: evidenceId,
      createdBy: actor,
    });
    await db.insert(facebookPublicationManifest).values({
      publicationId: f.id,
      contentVersion: 1,
      format: "image",
      caption,
      mediaId,
      confirmedBy: actor,
      media: { assetRef: evidenceId, contentType: "image/png", sizeBytes: 100, sha256 },
    });
    return { ...f, mediaId };
  }
  async function claim() {
    return claimNextSocialWorkerJob(workerId, new Date(), database);
  }
  async function expectPaused(jobId: string) {
    assert.equal(await claim(), null);
    const [job] = await db
      .select()
      .from(schema.socialBrowserJob)
      .where(eq(schema.socialBrowserJob.id, jobId));
    assert.equal(job.status, "paused");
  }
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(schema.user)
      .values({ id: actor, name: "Synthetic", email: `${actor}@example.invalid` });
    await db
      .insert(schema.workspaceProject)
      .values({ id: projectId, kind: "marketing", title: "SYNTHETIC", createdById: actor });
    await db.insert(schema.workspaceProjectMember).values({
      id: randomUUID(),
      projectId,
      userId: actor,
      createdById: actor,
      role: "owner",
    });
    await db.insert(schema.socialChannelControl).values({
      id: randomUUID(),
      channelRef,
      accountRef,
      enabled: true,
      circuitStatus: "active",
      changedBy: actor,
      changedAt: now,
    });

    const text = await fixture("text", accountRef, true);
    const claimed = await claim();
    assert.ok(claimed);
    assert.equal(claimed.command.command.jobId, text.jobId);
    await authorizeFacebookPublication(claimed.command, claimed.payload, database);
    await assert.rejects(
      authorizeFacebookPublication(
        claimed.command,
        { ...claimed.payload, text: "tampered" },
        database,
      ),
    );
    await db
      .update(schema.aggregateRecord)
      .set({ payload: { body: "changed after claim" } })
      .where(eq(schema.aggregateRecord.id, text.contentRef));
    await assert.rejects(authorizeFacebookPublication(claimed.command, claimed.payload, database));
    console.log("PASS text claim authorizes; tampering and post-claim edits denied");

    const beforeClaim = await fixture();
    await db
      .update(schema.aggregateRecord)
      .set({ version: 2 })
      .where(eq(schema.aggregateRecord.id, beforeClaim.contentRef));
    await expectPaused(beforeClaim.jobId);
    assert.ok(
      (await listProjectPublicationData(projectId, database)).candidates.some(
        (item) => item.id === beforeClaim.contentRef,
      ),
    );
    const reconfirmed = await submitControlledPublication(
      {
        projectId,
        contentRef: beforeClaim.contentRef,
        format: "text",
        channelRef,
        accountRef,
        previewDigest: (await listProjectPublicationData(projectId, database)).candidates.find(
          (item) => item.id === beforeClaim.contentRef,
        )?.previewDigest,
        confirmationRef: `evidence-reconfirmed-${randomUUID()}`,
      },
      actor,
      database,
    );
    assert.equal(reconfirmed.textConfirmation?.contentVersion, 2);
    const renewedClaim = await claim();
    assert.ok(renewedClaim);
    assert.equal(renewedClaim.command.command.jobId, reconfirmed.browserJobId);
    await authorizeFacebookPublication(renewedClaim.command, renewedClaim.payload, database);

    const bodyChanged = await fixture();
    // Even a writer that fails to increment the version must not alter confirmed text.
    await db
      .update(schema.aggregateRecord)
      .set({ payload: { body: "changed before claim" } })
      .where(eq(schema.aggregateRecord.id, bodyChanged.contentRef));
    await expectPaused(bodyChanged.jobId);
    const historical = await fixture();
    await db
      .update(schema.socialPublication)
      .set({ textConfirmation: null })
      .where(eq(schema.socialPublication.id, historical.id));
    await expectPaused(historical.jobId);
    const reapproved = await fixture();
    await db.insert(schema.approval).values({
      id: randomUUID(),
      aggregateId: reapproved.contentRef,
      gate: "gate_01_truth",
      status: "approved",
      requestedByType: "human",
      requestedById: actor,
      requestedAt: new Date(now.getTime() + 1000),
      decidedByType: "human",
      decidedById: actor,
      decidedAt: new Date(now.getTime() + 1000),
      evidenceRef: "synthetic-new-review",
    });
    await expectPaused(reapproved.jobId);
    const rejected = await fixture();
    await db.insert(schema.approval).values({
      id: randomUUID(),
      aggregateId: rejected.contentRef,
      gate: "gate_01_truth",
      status: "rejected",
      requestedByType: "human",
      requestedById: actor,
      requestedAt: new Date(now.getTime() + 1000),
      decidedByType: "human",
      decidedById: actor,
      decidedAt: new Date(now.getTime() + 1000),
      evidenceRef: "synthetic-rejected-review",
    });
    await expectPaused(rejected.jobId);
    console.log(
      "PASS text confirmation rejects pre-claim versions, body edits, historical rows and changed approvals",
    );

    const image = await imageFixture();
    const mediaClaim = await claim();
    assert.ok(mediaClaim);
    assert.equal(mediaClaim.command.command.jobId, image.jobId);
    assert.equal(mediaClaim.payload.version, 2);
    await authorizeFacebookPublication(mediaClaim.command, mediaClaim.payload, database);
    await db
      .update(productMediaAsset)
      .set({ publicDistributionAllowed: false })
      .where(eq(productMediaAsset.id, image.mediaId));
    await assert.rejects(
      authorizeFacebookPublication(mediaClaim.command, mediaClaim.payload, database),
    );
    console.log("PASS image manifest authorizes; revoked rights denied");

    await expectPaused((await fixture("image")).jobId);
    const stale = await imageFixture();
    await db
      .update(schema.aggregateRecord)
      .set({ version: 2 })
      .where(eq(schema.aggregateRecord.id, stale.contentRef));
    await expectPaused(stale.jobId);
    const mismatched = await imageFixture();
    await db
      .update(schema.socialPublication)
      .set({ format: "text" })
      .where(eq(schema.socialPublication.id, mismatched.id));
    // A text publication must not silently inherit a previously confirmed image manifest.
    await expectPaused(mismatched.jobId);
    const wrongManifest = await imageFixture();
    await db
      .update(facebookPublicationManifest)
      .set({ format: "video" })
      .where(eq(facebookPublicationManifest.publicationId, wrongManifest.id));
    await expectPaused(wrongManifest.jobId);
    const wrongPublication = await fixture();
    await db
      .update(schema.socialPublication)
      .set({ accountRef: randomUUID() })
      .where(eq(schema.socialPublication.id, wrongPublication.id));
    await expectPaused(wrongPublication.jobId);
    console.log("PASS missing, stale and mismatched manifests pause claims");

    const foreign = await fixture("text", randomUUID());
    const foreignStale = await fixture("text", randomUUID());
    await db
      .update(schema.socialBrowserJob)
      .set({ status: "claimed", updatedAt: new Date(now.getTime() - 11 * 60_000) })
      .where(eq(schema.socialBrowserJob.id, foreignStale.jobId));
    await assert.rejects(claimNextSocialWorkerJob("wrong-worker", now, database));
    const own = await fixture();
    const results = await Promise.all([claim(), claim()]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(results.find(Boolean)?.command.command.jobId, own.jobId);
    const [untouched] = await db
      .select()
      .from(schema.socialBrowserJob)
      .where(eq(schema.socialBrowserJob.id, foreign.jobId));
    const [unexpired] = await db
      .select()
      .from(schema.socialBrowserJob)
      .where(eq(schema.socialBrowserJob.id, foreignStale.jobId));
    assert.equal(untouched.status, "queued");
    assert.equal(unexpired.status, "claimed");
    console.log("PASS worker/account isolation and concurrent single claim");
    const ownClaim = results.find(Boolean);
    assert.ok(ownClaim);
    await db
      .update(schema.socialBrowserJob)
      .set({ accountRef: randomUUID() })
      .where(eq(schema.socialBrowserJob.id, own.jobId));
    await assert.rejects(
      authorizeFacebookPublication(ownClaim.command, ownClaim.payload, database),
    );
    await db
      .update(schema.socialBrowserJob)
      .set({ accountRef, updatedAt: new Date(now.getTime() - 11 * 60_000) })
      .where(eq(schema.socialBrowserJob.id, own.jobId));
    assert.equal(await claim(), null);
    const [expired] = await db
      .select()
      .from(schema.socialBrowserJob)
      .where(eq(schema.socialBrowserJob.id, own.jobId));
    const [unknown] = await db
      .select()
      .from(schema.socialPublication)
      .where(eq(schema.socialPublication.id, own.id));
    assert.equal(expired.status, "paused");
    assert.equal(unknown.status, "unknown");
    await assert.rejects(
      authorizeFacebookPublication(ownClaim.command, ownClaim.payload, database),
    );
    console.log("PASS authorization checks job scope; own timed-out claim pauses without retry");
    await db
      .update(schema.socialChannelControl)
      .set({ circuitStatus: "active", pauseReason: null })
      .where(eq(schema.socialChannelControl.accountRef, accountRef));
    await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, actor));
    const sessionId = randomUUID();
    await db.insert(schema.session).values({
      id: sessionId,
      token: randomUUID(),
      userId: actor,
      expiresAt: new Date(Date.now() + 3600000),
    });
    const owner = { id: actor, sessionId };
    const node = await ownerBrowserCommand(
      {
        operation: "create",
        value: {
          name: "Synthetic publication node",
          gatewayOrigin: "https://synthetic-node.example.invalid",
          maxBrowsers: 1,
          memoryBudgetMb: 2048,
          browserMemoryMb: 2048,
        },
      },
      owner,
    );
    assert.ok(node.nodeId && node.accessKey);
    await ownerBrowserCommand(
      {
        operation: "grant",
        value: {
          nodeId: node.nodeId,
          channelRef,
          accountRef,
          expectedEgressIp: "203.0.113.10",
          pollSeconds: 0,
          credentials: {
            loginUsername: "",
            loginPassword: "",
            proxyHost: "synthetic-proxy.example.invalid",
            proxyPort: "3128",
            proxyUsername: "",
            proxyPassword: "",
            clearLogin: false,
            clearProxy: false,
          },
        },
      },
      owner,
    );
    const metadata = await db.execute(
      sql`SELECT document FROM browser_fleet_node WHERE id = ${node.nodeId}`,
    );
    const nodeAccount = (metadata.rows[0].document as { accounts: Array<{ id: string }> })
      .accounts[0].id;
    await ownerBrowserCommand(
      { operation: "confirm-login", nodeId: node.nodeId, accountId: nodeAccount, confirmed: true },
      owner,
    );
    const identity = { installationId: randomUUID(), bootId: randomUUID() };
    await handleBrowserNodeRequest(node.accessKey, {
      ...identity,
      operation: "recover",
      stoppedRunIds: [],
      capabilities: ["interactive", "publish"],
    });
    const fleetJob = await fixture();
    assert.equal(await claim(), null, "Legacy worker must not claim a node-bound account");
    const request = {
      ...identity,
      operation: "claim",
      requestId: randomUUID(),
      availableMemoryMb: 4096,
      localSlots: 1,
    };
    await handleBrowserNodeRequest(node.accessKey, {
      ...identity,
      operation: "recover",
      stoppedRunIds: [],
      capabilities: ["interactive", "publish"],
      publicationScopes: [
        {
          channelRef: "unconfigured-channel",
          accountRef: "unconfigured-account",
          expiresAt: Date.now() + 60000,
        },
      ],
    });
    assert.equal((await handleBrowserNodeRequest(node.accessKey, request)).run, null);
    const unconfiguredReservation = await db.execute(
      sql`SELECT job_id FROM browser_fleet_publication WHERE job_id = ${fleetJob.jobId}`,
    );
    assert.equal(unconfiguredReservation.rows.length, 0);
    await handleBrowserNodeRequest(node.accessKey, {
      ...identity,
      operation: "recover",
      stoppedRunIds: [],
      capabilities: ["interactive", "publish"],
    });
    const requests = [request, { ...request, requestId: randomUUID() }];
    const responses = await Promise.all(
      requests.map((item) => handleBrowserNodeRequest(node.accessKey!, item)),
    );
    const leases = responses.map((r) => r.run).filter(Boolean) as Array<{
      id: string;
      leaseId: string;
      jobRef: string;
      publication: Record<string, unknown>;
    }>;
    assert.equal(leases.length, 1);
    assert.equal(leases[0].jobRef, fleetJob.jobId);
    assert.equal(leases[0].publication.publicationId, fleetJob.id);
    await assert.rejects(
      recordControlledPublicationResult(
        {
          jobId: fleetJob.jobId,
          outcome: "published",
          externalPublicationRef: "synthetic-forged-receipt",
        },
        database,
      ),
      /绑定租约/,
    );
    const reservation = await db.execute(
      sql`SELECT * FROM browser_fleet_publication WHERE job_id = ${fleetJob.jobId}`,
    );
    assert.equal(reservation.rows.length, 1);
    assert.equal(reservation.rows[0].run_id, leases[0].id);
    const winningIndex = responses.findIndex((item) => item.run);
    const repeat = await handleBrowserNodeRequest(node.accessKey, requests[winningIndex]);
    assert.deepEqual(
      repeat.run,
      responses[winningIndex].run,
      "Same request must return the original lease and payload",
    );
    const authorizationRequest = {
      ...identity,
      operation: "authorize-publication",
      runId: leases[0].id,
      leaseId: leases[0].leaseId,
      payloadDigest: digestSocialWorkerPayload(leases[0].publication),
    };
    await assert.rejects(
      handleBrowserNodeRequest(node.accessKey, authorizationRequest),
      /publication_lease_inactive/,
    );
    await handleBrowserNodeRequest(node.accessKey, {
      ...identity,
      operation: "heartbeat",
      runId: leases[0].id,
      leaseId: leases[0].leaseId,
      ready: true,
    });
    await db.execute(
      sql`UPDATE browser_fleet_node SET document = jsonb_set(document, '{publicationScopes}', '[]'::jsonb) WHERE id = ${node.nodeId}`,
    );
    await assert.rejects(
      handleBrowserNodeRequest(node.accessKey, authorizationRequest),
      /publication_lease_inactive/,
    );
    await db.execute(
      sql`UPDATE browser_fleet_node SET document = document - 'publicationScopes' WHERE id = ${node.nodeId}`,
    );
    await assert.rejects(
      handleBrowserNodeRequest(node.accessKey, { ...authorizationRequest, leaseId: randomUUID() }),
      /lease_mismatch/,
    );
    await assert.rejects(
      handleBrowserNodeRequest(node.accessKey, {
        ...authorizationRequest,
        payloadDigest: "0".repeat(64),
      }),
      /publication_payload_invalid/,
    );
    const authorization = await handleBrowserNodeRequest(node.accessKey, authorizationRequest);
    const replayAuthorization = await handleBrowserNodeRequest(
      node.accessKey,
      authorizationRequest,
    );
    assert.deepEqual(replayAuthorization.authorization, authorization.authorization);
    await db.execute(
      sql`UPDATE browser_fleet_publication SET authorized_until = 1 WHERE job_id = ${fleetJob.jobId}`,
    );
    await assert.rejects(
      handleBrowserNodeRequest(node.accessKey, authorizationRequest),
      /publication_authorization_expired/,
    );
    const [beforeEdit] = await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.id, fleetJob.contentRef));
    await db
      .update(schema.aggregateRecord)
      .set({ version: beforeEdit.version + 1 })
      .where(eq(schema.aggregateRecord.id, fleetJob.contentRef));
    await assert.rejects(
      handleBrowserNodeRequest(node.accessKey, authorizationRequest),
      /text_confirmation_stale_or_missing/,
    );
    console.log(
      "PASS node authorization checks readiness, lease, payload and current content; replay never refreshes an expired attempt",
    );
    await assert.rejects(
      handleBrowserNodeRequest(node.accessKey, {
        ...identity,
        operation: "finish",
        runId: leases[0].id,
        leaseId: randomUUID(),
        outcome: "completed",
        stopped: true,
      }),
    );
    await ownerBrowserCommand(
      { operation: "stop", nodeId: node.nodeId, runId: leases[0].id },
      owner,
    );
    await assert.rejects(
      handleBrowserNodeRequest(node.accessKey, authorizationRequest),
      /publication_lease_inactive/,
    );
    await handleBrowserNodeRequest(node.accessKey, {
      ...identity,
      operation: "finish",
      runId: leases[0].id,
      leaseId: leases[0].leaseId,
      outcome: "completed",
      stopped: true,
    });
    const [fleetOutcome] = await db
      .select()
      .from(schema.socialPublication)
      .where(eq(schema.socialPublication.id, fleetJob.id));
    assert.equal(fleetOutcome.status, "unknown", "Browser completion is not a publication receipt");
    assert.equal(
      (await handleBrowserNodeRequest(node.accessKey, { ...request, requestId: randomUUID() })).run,
      null,
    );
    console.log(
      "PASS actual broker reserves one publication, excludes legacy claims, replays the lease and keeps unreceipted completion unknown",
    );

    for (const outcome of ["published", "unknown", "expired", "media"] as const) {
      accountRef = randomUUID();
      await db.insert(schema.socialChannelControl).values({
        id: randomUUID(),
        channelRef,
        accountRef,
        enabled: true,
        circuitStatus: "active",
        changedBy: actor,
        changedAt: new Date(),
      });
      await ownerBrowserCommand(
        {
          operation: "grant",
          value: {
            nodeId: node.nodeId,
            channelRef,
            accountRef,
            expectedEgressIp: "203.0.113.10",
            pollSeconds: 0,
            credentials: {
              loginUsername: "",
              loginPassword: "",
              proxyHost: "synthetic-proxy.example.invalid",
              proxyPort: "3128",
              proxyUsername: "",
              proxyPassword: "",
              clearLogin: false,
              clearProxy: false,
            },
          },
        },
        owner,
      );
      const nodeRow: { rows: Array<Record<string, unknown>> } = await db.execute(
        sql`SELECT document FROM browser_fleet_node WHERE id = ${node.nodeId}`,
      );
      const bound: { id: string; accountRef: string } | undefined = (
        nodeRow.rows[0].document as { accounts: Array<{ id: string; accountRef: string }> }
      ).accounts.find((a) => a.accountRef === accountRef);
      assert.ok(bound);
      await ownerBrowserCommand(
        { operation: "confirm-login", nodeId: node.nodeId, accountId: bound.id, confirmed: true },
        owner,
      );
      const expectedOutcome = outcome === "published" ? "published" : "unknown";
      const target = outcome === "media" ? await imageFixture() : await fixture();
      const claimResponse = await handleBrowserNodeRequest(node.accessKey, {
        ...request,
        requestId: randomUUID(),
      });
      const lease = claimResponse.run as { id: string; leaseId: string; publicationDigest: string };
      assert.ok(lease);
      await handleBrowserNodeRequest(node.accessKey, {
        ...identity,
        operation: "heartbeat",
        runId: lease.id,
        leaseId: lease.leaseId,
        ready: true,
      });
      if (outcome === "media") {
        let opened = 0;
        const mediaRequest = {
          ...identity,
          operation: "publication-media",
          runId: lease.id,
          leaseId: lease.leaseId,
          payloadDigest: lease.publicationDigest,
        };
        const openMedia = async (source: {
          blobKey: string;
          media: {
            assetRef: string;
            contentType: "image/png" | "image/jpeg" | "video/mp4";
            sizeBytes: number;
            sha256: string;
          };
        }) => {
          opened++;
          assert.ok(source.blobKey.startsWith("synthetic/"));
          return {
            stream: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(100));
                controller.close();
              },
            }),
            media: source.media,
          };
        };
        await assert.rejects(
          handleBrowserNodeRequest(
            node.accessKey,
            { ...mediaRequest, leaseId: randomUUID() },
            openMedia,
          ),
          /lease_mismatch/,
        );
        assert.equal(opened, 0);
        const delivered = await handleBrowserNodeRequest(node.accessKey, mediaRequest, openMedia);
        assert.equal("mediaSource" in delivered, false);
        assert.equal("blobKey" in delivered, false);
        assert.equal(
          (await new Response(delivered.stream as ReadableStream).arrayBuffer()).byteLength,
          100,
        );
        assert.equal(opened, 1);
        assert.ok("mediaId" in target && typeof target.mediaId === "string");
        await db
          .update(productMediaAsset)
          .set({ publicDistributionAllowed: false })
          .where(eq(productMediaAsset.id, target.mediaId));
        await assert.rejects(
          handleBrowserNodeRequest(node.accessKey, mediaRequest, openMedia),
          /image_rights_invalid/,
        );
        assert.equal(opened, 1, "Revoked media must not reach private storage");
        await handleBrowserNodeRequest(node.accessKey, {
          ...identity,
          operation: "finish",
          runId: lease.id,
          leaseId: lease.leaseId,
          outcome: "unknown",
          stopped: true,
        });
        await assert.rejects(
          handleBrowserNodeRequest(node.accessKey, mediaRequest, openMedia),
          /publication_lease_inactive/,
        );
        continue;
      }
      const authorized = await handleBrowserNodeRequest(node.accessKey, {
        ...identity,
        operation: "authorize-publication",
        runId: lease.id,
        leaseId: lease.leaseId,
        payloadDigest: lease.publicationDigest,
      });
      const resultRequest = {
        ...identity,
        operation: "publication-result",
        runId: lease.id,
        leaseId: lease.leaseId,
        authorizationId: (authorized.authorization as { authorizationId: string }).authorizationId,
        payloadDigest: lease.publicationDigest,
        outcome: outcome === "published" ? "published" : "unknown",
        ...(outcome === "published"
          ? { externalPublicationRef: `synthetic-post-${randomUUID()}` }
          : { failureCode: "synthetic_observation_unknown" }),
      };
      await assert.rejects(
        handleBrowserNodeRequest(node.accessKey, {
          ...resultRequest,
          authorizationId: randomUUID(),
        }),
        /publication_receipt_scope_invalid/,
      );
      if (outcome === "expired") {
        const document = await db.execute(
          sql`SELECT document FROM browser_fleet_node WHERE id = ${node.nodeId}`,
        );
        const state = document.rows[0].document as {
          runs: Array<{ id: string; leaseUntil: number }>;
        };
        const active = state.runs.find((r) => r.id === lease.id);
        assert.ok(active);
        active.leaseUntil = 1;
        await db.execute(
          sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(state)}::jsonb WHERE id = ${node.nodeId}`,
        );
        await assert.rejects(
          handleBrowserNodeRequest(node.accessKey, resultRequest),
          /publication_lease_inactive/,
        );
        await handleBrowserNodeRequest(node.accessKey, { ...identity, operation: "sync" });
      } else {
        const accepted = await handleBrowserNodeRequest(node.accessKey, resultRequest);
        assert.deepEqual(accepted.receipt, { outcome: expectedOutcome, replayed: false });
        const repeated = await handleBrowserNodeRequest(node.accessKey, resultRequest);
        assert.deepEqual(repeated.receipt, { outcome: expectedOutcome, replayed: true });
        await assert.rejects(
          handleBrowserNodeRequest(node.accessKey, {
            ...resultRequest,
            ...(outcome === "published"
              ? { externalPublicationRef: "synthetic-conflicting-post" }
              : { failureCode: "synthetic_conflict" }),
          }),
          /publication_receipt_conflict/,
        );
      }
      await handleBrowserNodeRequest(node.accessKey, {
        ...identity,
        operation: "finish",
        runId: lease.id,
        leaseId: lease.leaseId,
        outcome: "completed",
        stopped: true,
      });
      const [saved] = await db
        .select()
        .from(schema.socialPublication)
        .where(eq(schema.socialPublication.id, target.id));
      assert.equal(saved.status, outcome === "published" ? "published" : "unknown");
      if (outcome === "published") {
        const [record] = await db
          .select()
          .from(schema.aggregateRecord)
          .where(eq(schema.aggregateRecord.id, target.contentRef));
        assert.equal(record.state, "CONTENT_PUBLISHED");
        assert.equal(record.version, 2);
        const repeated = await handleBrowserNodeRequest(node.accessKey, resultRequest);
        assert.deepEqual(repeated.receipt, { outcome: expectedOutcome, replayed: true });
        const duplicateTarget = await fixture();
        const duplicateClaim = await handleBrowserNodeRequest(node.accessKey, {
          ...request,
          requestId: randomUUID(),
        });
        const duplicateLease = duplicateClaim.run as {
          id: string;
          leaseId: string;
          publicationDigest: string;
        };
        await handleBrowserNodeRequest(node.accessKey, {
          ...identity,
          operation: "heartbeat",
          runId: duplicateLease.id,
          leaseId: duplicateLease.leaseId,
          ready: true,
        });
        const duplicateAuthorization = await handleBrowserNodeRequest(node.accessKey, {
          ...identity,
          operation: "authorize-publication",
          runId: duplicateLease.id,
          leaseId: duplicateLease.leaseId,
          payloadDigest: duplicateLease.publicationDigest,
        });
        await assert.rejects(
          handleBrowserNodeRequest(node.accessKey, {
            ...resultRequest,
            runId: duplicateLease.id,
            leaseId: duplicateLease.leaseId,
            payloadDigest: duplicateLease.publicationDigest,
            authorizationId: (duplicateAuthorization.authorization as { authorizationId: string })
              .authorizationId,
          }),
          /publication_external_ref_duplicate/,
        );
        const [uncommitted] = await db
          .select()
          .from(schema.socialPublication)
          .where(eq(schema.socialPublication.id, duplicateTarget.id));
        assert.equal(uncommitted.status, "submitted");
        await handleBrowserNodeRequest(node.accessKey, {
          ...identity,
          operation: "finish",
          runId: duplicateLease.id,
          leaseId: duplicateLease.leaseId,
          outcome: "unknown",
          stopped: true,
        });
      }
    }
    console.log(
      "PASS receipt authorization binding, success/unknown persistence, duplicate replay, conflict rejection, lease expiry and shutdown preservation",
    );
    await testFacebookInbound(database, actor);
  } finally {
    await closeDatabase();
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
