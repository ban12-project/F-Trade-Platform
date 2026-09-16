import "server-only";
import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import { evidence, productSourceImage, user, workspaceProjectMember } from "@/lib/db/schema";
import { verifyDocumentUploadBytes } from "./document-upload-bytes";

export async function readProductSourceImage(
  productId: string,
  evidenceId: string,
  actorId: string,
  database: Database = getDatabase(),
  readBlob: typeof get = get,
) {
  const authorizedImage = () =>
    database
      .select({
        blobKey: evidence.blobKey,
        sha256: evidence.sha256,
        sizeBytes: evidence.sizeBytes,
        contentType: evidence.contentType,
      })
      .from(productSourceImage)
      .innerJoin(evidence, eq(evidence.id, productSourceImage.evidenceId))
      .innerJoin(
        workspaceProjectMember,
        and(
          eq(workspaceProjectMember.projectId, productSourceImage.projectId),
          eq(workspaceProjectMember.userId, actorId),
        ),
      )
      .innerJoin(user, and(eq(user.id, actorId), eq(user.banned, false)))
      .where(
        and(
          eq(productSourceImage.productId, productId),
          eq(productSourceImage.evidenceId, evidenceId),
        ),
      )
      .limit(1);
  const [record] = await authorizedImage();
  if (!record || !["image/png", "image/jpeg"].includes(record.contentType) || !record.sizeBytes)
    return null;
  const blob = await readBlob(record.blobKey, { access: "private", useCache: false });
  if (
    !blob ||
    blob.statusCode !== 200 ||
    !blob.stream ||
    blob.blob.contentType !== record.contentType
  )
    return null;
  const verified = await verifyDocumentUploadBytes(
    blob.stream,
    record.contentType === "image/png" ? "source.png" : "source.jpg",
    record.sizeBytes,
  );
  if (verified.sha256 !== record.sha256 || !(await authorizedImage()).length) return null;
  return { bytes: verified.bytes, contentType: record.contentType };
}
