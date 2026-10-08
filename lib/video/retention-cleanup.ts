import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { del } from "@vercel/blob";
import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  approval,
  auditEvent,
  evidence,
  videoGeneratedAsset,
  videoProcessingJob,
  videoRetentionCleanup,
} from "@/lib/db/schema";
import { videoRetentionDays, videoRetentionPolicyVersion } from "./retention-policy";

type DeleteStore = { delete(path: string): Promise<void> };
const privateDeleteStore: DeleteStore = {
  delete: (path) =>
    del(path, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
      abortSignal: AbortSignal.timeout(10_000),
    }),
};
const expired = (
  createdAt:
    | typeof aggregateRecord.createdAt
    | typeof evidence.createdAt
    | typeof videoGeneratedAsset.createdAt,
) => sql`${createdAt} <= clock_timestamp() - (${videoRetentionDays} * interval '1 day')`;
const noCleanup = (
  kind: "video" | "asset" | "evidence",
  ref: typeof aggregateRecord.id | typeof evidence.id | typeof videoGeneratedAsset.assetRef,
  database: Database,
) =>
  notExists(
    database
      .select({ id: videoRetentionCleanup.id })
      .from(videoRetentionCleanup)
      .where(
        and(eq(videoRetentionCleanup.objectKind, kind), eq(videoRetentionCleanup.objectRef, ref)),
      ),
  );

/** Only exact server-created working labels; source, rights and non-video use protect bytes. */
export function unprotectedWorkingEvidenceCondition() {
  return sql`(
    ${evidence.sourceLabel} IN ('marketing-upload:image', 'marketing-upload:video', 'internet-search:wikimedia-commons:private-test-only')
    AND NOT EXISTS (SELECT 1 FROM product_media_asset p WHERE p.evidence_id = ${evidence.id} OR p.rights_evidence_ref = ${evidence.id} OR p.review_evidence_ref = ${evidence.id})
    AND NOT EXISTS (SELECT 1 FROM product_source_image p WHERE p.evidence_id = ${evidence.id})
    AND NOT EXISTS (SELECT 1 FROM product_document_upload_receipt p WHERE p.evidence_id = ${evidence.id})
    AND NOT EXISTS (SELECT 1 FROM product_catalog_import p WHERE p.evidence_id = ${evidence.id})
    AND NOT EXISTS (SELECT 1 FROM approval p WHERE p.evidence_ref = ${evidence.id})
    AND NOT EXISTS (SELECT 1 FROM aggregate_record p WHERE p.type <> 'video' AND strpos(p.payload::text, ${evidence.id}) > 0)
  )`;
}

/** Enqueue and redact under the same row lock. No raw payload enters the outbox/audit. */
async function expireVideo(id: string, database: Database) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
    const [row] = await tx
      .select()
      .from(aggregateRecord)
      .where(
        and(
          eq(aggregateRecord.id, id),
          eq(aggregateRecord.type, "video"),
          expired(aggregateRecord.createdAt),
        ),
      )
      .for("update");
    if (!row) return false;
    const [existing] = await tx
      .select({ id: videoRetentionCleanup.id })
      .from(videoRetentionCleanup)
      .where(
        and(eq(videoRetentionCleanup.objectKind, "video"), eq(videoRetentionCleanup.objectRef, id)),
      );
    if (existing) return false;
    const now = new Date();
    const contentHash = createHash("sha256").update(JSON.stringify(row.payload)).digest("hex");
    await tx.insert(videoRetentionCleanup).values({
      id: randomUUID(),
      objectKind: "video",
      objectRef: id,
      status: "purged",
      policyVersion: videoRetentionPolicyVersion,
      originalCreatedAt: row.createdAt,
      contentHash,
      completedAt: now,
    });
    await tx
      .update(aggregateRecord)
      .set({
        payload: { id, retention: { purged: true, policyVersion: videoRetentionPolicyVersion } },
        version: sql`${aggregateRecord.version} + 1`,
      })
      .where(eq(aggregateRecord.id, id));
    await tx.update(approval).set({ notes: null }).where(eq(approval.aggregateId, id));
    await tx
      .update(videoProcessingJob)
      .set({
        status: "failed",
        failureCode: "RETENTION_EXPIRED",
        failureMessage: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(videoProcessingJob.videoProjectId, id),
          inArray(videoProcessingJob.status, ["queued", "running"]),
        ),
      );
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "video_retention.payload_purged",
      actorType: "system",
      actorId: "video-retention",
      aggregateId: id,
      subjectType: "video",
      subjectId: id,
      metadata: { policy_version: videoRetentionPolicyVersion, content_hash: contentHash },
      occurredAt: now,
    });
    return true;
  });
}

async function enqueueAsset(ref: string, database: Database) {
  await database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
    const [row] = await tx
      .select()
      .from(videoGeneratedAsset)
      .where(and(eq(videoGeneratedAsset.assetRef, ref), expired(videoGeneratedAsset.createdAt)))
      .for("update");
    if (!row) return;
    if (
      !/^video\/(?:rendered\/mvp1|generated\/[^/]+\/[^/]+)\/asset-[a-z0-9_-]+\.mp4$/i.test(
        row.blobPath,
      )
    )
      throw new Error("Invalid retention path");
    await tx
      .insert(videoRetentionCleanup)
      .values({
        id: randomUUID(),
        objectKind: "asset",
        objectRef: ref,
        blobPath: row.blobPath,
        policyVersion: videoRetentionPolicyVersion,
        originalCreatedAt: row.createdAt,
      })
      .onConflictDoNothing();
  });
}

async function enqueueEvidence(ref: string, database: Database) {
  await database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
    const [row] = await tx
      .select()
      .from(evidence)
      .where(
        and(
          eq(evidence.id, ref),
          expired(evidence.createdAt),
          unprotectedWorkingEvidenceCondition(),
        ),
      )
      .for("update");
    if (!row) return;
    if (!row.blobKey.startsWith(`evidence/${row.id}/`)) throw new Error("Invalid retention path");
    await tx
      .insert(videoRetentionCleanup)
      .values({
        id: randomUUID(),
        objectKind: "evidence",
        objectRef: ref,
        blobPath: row.blobKey,
        policyVersion: videoRetentionPolicyVersion,
        originalCreatedAt: row.createdAt,
        contentHash: row.sha256,
      })
      .onConflictDoNothing();
  });
}

/** Bounded, idempotent storage cleanup. A lost delete/commit response is safely retryable. */
export async function purgeVideoRetentionObject(
  id: string,
  database: Database = getDatabase(),
  store: DeleteStore = privateDeleteStore,
) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
    const [job] = await tx
      .select()
      .from(videoRetentionCleanup)
      .where(eq(videoRetentionCleanup.id, id))
      .for("update");
    if (!job || job.status === "purged") return "purged" as const;
    if (!job.blobPath) throw new Error("Invalid retention job");
    if (job.objectKind === "evidence") {
      const [row] = await tx
        .select()
        .from(evidence)
        .where(eq(evidence.id, job.objectRef))
        .for("update");
      // A reference may have committed while the lock was unavailable. Use a fresh statement snapshot.
      const [eligible] = await tx
        .select({ id: evidence.id })
        .from(evidence)
        .where(
          and(
            eq(evidence.id, job.objectRef),
            expired(evidence.createdAt),
            unprotectedWorkingEvidenceCondition(),
          ),
        );
      if (!eligible || !row || row.blobKey !== job.blobPath) return "protected" as const;
      if (!row.blobKey.startsWith(`evidence/${row.id}/`)) throw new Error("Invalid retention path");
      await store.delete(job.blobPath);
      await tx
        .update(evidence)
        .set({ blobKey: `retired/${row.id}`, sizeBytes: 0 })
        .where(eq(evidence.id, row.id));
    } else if (job.objectKind === "asset") {
      const [row] = await tx
        .select()
        .from(videoGeneratedAsset)
        .where(
          and(
            eq(videoGeneratedAsset.assetRef, job.objectRef),
            expired(videoGeneratedAsset.createdAt),
          ),
        )
        .for("update");
      if (!row || row.blobPath !== job.blobPath) return "protected" as const;
      if (
        !/^video\/(?:rendered\/mvp1|generated\/[^/]+\/[^/]+)\/asset-[a-z0-9_-]+\.mp4$/i.test(
          row.blobPath,
        )
      )
        throw new Error("Invalid retention path");
      await store.delete(job.blobPath);
      await tx
        .update(videoGeneratedAsset)
        .set({ blobPath: `retired/${row.assetRef}`, sizeBytes: 0 })
        .where(eq(videoGeneratedAsset.assetRef, row.assetRef));
    } else throw new Error("Invalid retention kind");
    const now = new Date();
    await tx
      .update(videoRetentionCleanup)
      .set({
        status: "purged",
        blobPath: null,
        attempts: sql`${videoRetentionCleanup.attempts} + 1`,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(videoRetentionCleanup.id, id));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "video_retention.object_purged",
      actorType: "system",
      actorId: "video-retention",
      subjectType: job.objectKind,
      subjectId: job.objectRef,
      metadata: { policy_version: job.policyVersion, content_hash: job.contentHash },
      occurredAt: now,
    });
    return "purged" as const;
  });
}

export async function cleanupExpiredVideoObjects(
  database: Database = getDatabase(),
  store: DeleteStore = privateDeleteStore,
) {
  const deadline = Date.now() + 45_000;
  const videos = await database
    .select({ id: aggregateRecord.id })
    .from(aggregateRecord)
    .where(
      and(
        eq(aggregateRecord.type, "video"),
        expired(aggregateRecord.createdAt),
        noCleanup("video", aggregateRecord.id, database),
      ),
    )
    .orderBy(aggregateRecord.createdAt)
    .limit(50);
  const assets = await database
    .select({ id: videoGeneratedAsset.assetRef })
    .from(videoGeneratedAsset)
    .where(
      and(
        expired(videoGeneratedAsset.createdAt),
        noCleanup("asset", videoGeneratedAsset.assetRef, database),
      ),
    )
    .orderBy(videoGeneratedAsset.createdAt)
    .limit(50);
  const working = await database
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(
        expired(evidence.createdAt),
        unprotectedWorkingEvidenceCondition(),
        noCleanup("evidence", evidence.id, database),
      ),
    )
    .orderBy(evidence.createdAt)
    .limit(50);
  const result = { videosPurged: 0, objectsPurged: 0, protected: 0, failed: 0 };
  for (const item of videos) {
    if (Date.now() >= deadline) break;
    try {
      if (await expireVideo(item.id, database)) result.videosPurged++;
    } catch {
      result.failed++;
    }
  }
  for (const item of assets) {
    if (Date.now() >= deadline) break;
    try {
      await enqueueAsset(item.id, database);
    } catch {
      result.failed++;
    }
  }
  for (const item of working) {
    if (Date.now() >= deadline) break;
    try {
      await enqueueEvidence(item.id, database);
    } catch {
      result.failed++;
    }
  }
  const pending = await database
    .select({ id: videoRetentionCleanup.id })
    .from(videoRetentionCleanup)
    .where(eq(videoRetentionCleanup.status, "pending"))
    .orderBy(videoRetentionCleanup.updatedAt)
    .limit(50);
  for (const job of pending) {
    if (Date.now() >= deadline) break;
    try {
      const state = await purgeVideoRetentionObject(job.id, database, store);
      if (state === "purged") result.objectsPurged++;
      else result.protected++;
    } catch {
      result.failed++;
    }
    // Rotate without changing status, including failures and newly protected references.
    await database
      .update(videoRetentionCleanup)
      .set({ updatedAt: new Date(), attempts: sql`${videoRetentionCleanup.attempts} + 1` })
      .where(
        and(eq(videoRetentionCleanup.id, job.id), eq(videoRetentionCleanup.status, "pending")),
      );
  }
  return result;
}
