import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, auditEvent, videoCanvasDocument } from "@/lib/db/schema";
import type { ProductReady } from "@/lib/product/verification";

import { saveVideoCanvasSchema, videoCanvasDocumentSchema, type SaveVideoCanvasInput, type VideoCanvasDocument } from "./canvas-contracts";

export class VideoCanvasRevisionConflictError extends Error {
  constructor() {
    super("画布已在另一处更新。请刷新后再保存，避免覆盖他人的修改。");
  }
}

export type StoredVideoCanvasDocument = { document: VideoCanvasDocument; revision: number };

export async function loadVideoCanvasDocument(ownerId: string, database: Database = getDatabase()): Promise<StoredVideoCanvasDocument | null> {
  const [row] = await database.select({ document: videoCanvasDocument.document, revision: videoCanvasDocument.revision })
    .from(videoCanvasDocument)
    .where(eq(videoCanvasDocument.ownerId, ownerId));
  if (!row) return null;
  return { document: videoCanvasDocumentSchema.parse(row.document), revision: row.revision };
}

/** Persists a personal layout only. No product facts, assets, prompts, or video-project state are written here. */
export async function saveVideoCanvasDocument(input: SaveVideoCanvasInput, ownerId: string, database: Database = getDatabase()): Promise<StoredVideoCanvasDocument> {
  const parsed = saveVideoCanvasSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    if (parsed.document.factBinding) {
      const [product] = await tx.select({ id: aggregateRecord.id, state: aggregateRecord.state, payload: aggregateRecord.payload })
        .from(aggregateRecord)
        .where(and(eq(aggregateRecord.id, parsed.document.factBinding.productId), eq(aggregateRecord.type, "product")))
        .for("update");
      const ready = product?.payload as unknown as ProductReady | undefined;
      if (!product || product.state !== "PRODUCT_READY" || !ready || ready.record_id !== product.id || ready.verification_status !== "verified") {
        throw new Error("画布引用的产品字段不再是已核验事实。请选择当前可用的产品字段。");
      }
      const evidenceRef = ready.field_evidence[parsed.document.factBinding.factPath];
      if (!evidenceRef || !ready.evidence_refs.includes(evidenceRef)) {
        throw new Error("画布引用的产品字段不再是已核验事实。请选择当前可用的产品字段。");
      }
    }
    if (parsed.expectedRevision === 0) {
      const [created] = await tx.insert(videoCanvasDocument).values({
        id: randomUUID(), ownerId, document: parsed.document, revision: 1,
      }).onConflictDoNothing({ target: videoCanvasDocument.ownerId }).returning({ revision: videoCanvasDocument.revision });
      if (created) {
        await tx.insert(auditEvent).values({
          id: randomUUID(), action: "video_canvas.created", actorType: "human", actorId: ownerId,
          subjectType: "video_canvas", subjectId: ownerId,
          metadata: { node_count: parsed.document.nodes.length, edge_count: parsed.document.edges.length, fact_binding: Boolean(parsed.document.factBinding) }, occurredAt: now,
        });
        return { document: parsed.document, revision: created.revision };
      }
      throw new VideoCanvasRevisionConflictError();
    }

    const [existing] = await tx.select({ revision: videoCanvasDocument.revision }).from(videoCanvasDocument)
      .where(eq(videoCanvasDocument.ownerId, ownerId)).for("update");
    if (!existing || existing.revision !== parsed.expectedRevision) throw new VideoCanvasRevisionConflictError();
    const revision = existing.revision + 1;
    await tx.update(videoCanvasDocument).set({ document: parsed.document, revision, updatedAt: now })
      .where(eq(videoCanvasDocument.ownerId, ownerId));
    await tx.insert(auditEvent).values({
      id: randomUUID(), action: "video_canvas.saved", actorType: "human", actorId: ownerId,
      subjectType: "video_canvas", subjectId: ownerId,
      metadata: { node_count: parsed.document.nodes.length, edge_count: parsed.document.edges.length, fact_binding: Boolean(parsed.document.factBinding), revision }, occurredAt: now,
    });
    return { document: parsed.document, revision };
  });
}
