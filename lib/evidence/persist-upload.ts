import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { type Database, getDatabase } from "@/lib/db/client";
import { evidence } from "@/lib/db/schema";

import type { EvidenceStore } from "./store";
import { VercelPrivateBlobEvidenceStore } from "./vercel-private-blob";

export type UploadEvidenceStore = Pick<EvidenceStore, "put"> & {
  delete(pathname: string): Promise<void>;
};

/** Each upload has its own provenance; a content digest never grants access. */
export async function persistUploadedEvidence(
  input: {
    actorId: string;
    filename: string;
    contentType: string;
    sha256: string;
    sizeBytes: number;
    sourceLabel: string;
    body: Blob;
  },
  database: Database = getDatabase(),
  store: UploadEvidenceStore = new VercelPrivateBlobEvidenceStore(),
) {
  const id = `evidence-${randomUUID()}`;
  const stored = await store.put({
    evidenceId: id,
    filename: input.filename,
    contentType: input.contentType,
    body: input.body,
  });
  try {
    await database.insert(evidence).values({
      id,
      classification: "restricted",
      blobKey: stored.pathname,
      contentType: stored.contentType,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      sourceLabel: input.sourceLabel,
      uploadedByType: "human",
      uploadedById: input.actorId,
    });
  } catch (error) {
    // A transport error may arrive before the server commits. A fresh read is
    // insufficient to prove rollback in that case; retain the blob on uncertainty.
    const cause = error instanceof Error ? error.cause : null;
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
    if (typeof code === "string" && code.startsWith("23")) {
      const [persisted] = await database
        .select({ id: evidence.id })
        .from(evidence)
        .where(eq(evidence.blobKey, stored.pathname));
      if (!persisted) await store.delete(stored.pathname);
    }
    throw error;
  }
  return id;
}
