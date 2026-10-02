import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type Database, getDatabase } from "@/lib/db/client";
import { evidence, evidenceUploadIntent } from "@/lib/db/schema";
import { type EvidenceStore, evidenceUploadPath } from "./store";
import { reconcileEvidenceUpload } from "./upload-reconciliation";
import { VercelPrivateBlobEvidenceStore } from "./vercel-private-blob";

export type UploadEvidenceStore = Pick<EvidenceStore, "put"> & {
  delete(pathname: string): Promise<void>;
};

const metadataSchema = z.object({
  actorId: z.string().trim().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sha256: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sourceLabel: z.string().min(1),
});

/** Each upload has its own provenance; unknown outcomes never authorize deletion. */
export async function persistUploadedEvidence(
  input: z.input<typeof metadataSchema> & { body: Blob },
  database: Database = getDatabase(),
  store: UploadEvidenceStore = new VercelPrivateBlobEvidenceStore(),
) {
  const metadata = metadataSchema.parse(input);
  const id = `evidence-${randomUUID()}`;
  const pathname = evidenceUploadPath({ evidenceId: id, filename: metadata.filename });
  // If this acknowledgement is lost, no storage operation is attempted.
  await database.insert(evidenceUploadIntent).values({
    id,
    blobKey: pathname,
    status: "upload_pending",
  });
  let acknowledged = false;
  try {
    const stored = await store.put({
      evidenceId: id,
      filename: metadata.filename,
      contentType: metadata.contentType,
      body: input.body,
      pathname,
    });
    if (stored.pathname !== pathname || stored.contentType !== metadata.contentType)
      throw new Error("Upload storage response mismatch");
    acknowledged = true;
    await database.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(evidenceUploadIntent)
        .where(eq(evidenceUploadIntent.id, id))
        .for("update");
      if (!intent || !["upload_pending", "uncertain"].includes(intent.status))
        throw new Error("Upload intent is not attachable");
      await tx.insert(evidence).values({
        id,
        classification: "restricted",
        blobKey: pathname,
        contentType: metadata.contentType,
        sha256: metadata.sha256,
        sizeBytes: metadata.sizeBytes,
        sourceLabel: metadata.sourceLabel,
        uploadedByType: "human",
        uploadedById: metadata.actorId,
      });
      await tx
        .update(evidenceUploadIntent)
        .set({ status: "attached", updatedAt: new Date() })
        .where(eq(evidenceUploadIntent.id, id));
    });
    return id;
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
    const definiteFailure = acknowledged && typeof code === "string" && /^23\d{3}$/.test(code);
    // Attached status commits atomically with evidence. A lost acknowledgement
    // cannot turn that committed object into a cleanup candidate.
    try {
      await database
        .update(evidenceUploadIntent)
        .set({ status: definiteFailure ? "cleanup_pending" : "uncertain", updatedAt: new Date() })
        .where(
          and(
            eq(evidenceUploadIntent.id, id),
            inArray(evidenceUploadIntent.status, ["upload_pending", "uncertain"]),
          ),
        );
      if (definiteFailure) await reconcileEvidenceUpload(id, database, store);
    } catch {
      // Preserve the original failure; a durable record remains for maintenance.
    }
    throw error;
  }
}
