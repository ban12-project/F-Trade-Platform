import { and, eq, inArray, lte } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import { evidence, evidenceUploadIntent } from "@/lib/db/schema";
import { VercelPrivateBlobEvidenceStore } from "./vercel-private-blob";

type DeleteStore = { delete(pathname: string): Promise<void> };

/** Called only by trusted upload code or the operator CLI, never a client action. */
export async function reconcileEvidenceUpload(
  id: string,
  database: Database = getDatabase(),
  store: DeleteStore = new VercelPrivateBlobEvidenceStore(),
) {
  return database.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(evidenceUploadIntent)
      .where(eq(evidenceUploadIntent.id, id))
      .for("update");
    if (!intent) throw new Error("Upload intent not found");
    if (intent.status === "cleaned") return "cleaned" as const;
    const [reference] = await tx
      .select({ id: evidence.id })
      .from(evidence)
      .where(eq(evidence.blobKey, intent.blobKey));
    let status: "attached" | "uncertain" | "cleaned" = reference ? "attached" : "uncertain";
    if (!reference && intent.status === "cleanup_pending") {
      // Only an acknowledged put followed by a definite rolled-back insert can
      // reach this state. Attachment takes the same row lock and refuses it.
      // A lost delete/commit response leaves this job retryable and idempotent.
      await store.delete(intent.blobKey);
      status = "cleaned";
    }
    await tx
      .update(evidenceUploadIntent)
      .set({ status, updatedAt: new Date() })
      .where(eq(evidenceUploadIntent.id, id));
    return status;
  });
}

/** Bounded, explicit maintenance; unknown storage writes are never deleted. */
export async function reconcileEvidenceUploads(
  database: Database = getDatabase(),
  store: DeleteStore = new VercelPrivateBlobEvidenceStore(),
) {
  const intents = await database
    .select({ id: evidenceUploadIntent.id })
    .from(evidenceUploadIntent)
    .where(
      and(
        inArray(evidenceUploadIntent.status, ["upload_pending", "uncertain", "cleanup_pending"]),
        lte(evidenceUploadIntent.updatedAt, new Date(Date.now() - 30 * 60_000)),
      ),
    )
    .orderBy(evidenceUploadIntent.updatedAt)
    .limit(100);
  const result = { examined: intents.length, attached: 0, uncertain: 0, cleaned: 0, failed: 0 };
  for (const intent of intents) {
    try {
      result[await reconcileEvidenceUpload(intent.id, database, store)]++;
    } catch {
      result.failed++;
      // Rotate failed jobs without replacing a concurrently completed status.
      await database
        .update(evidenceUploadIntent)
        .set({ updatedAt: new Date() })
        .where(eq(evidenceUploadIntent.id, intent.id));
    }
  }
  return result;
}
