import "server-only";
import { get } from "@vercel/blob";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type Database, getDatabase } from "@/lib/db/client";
import { productCatalogCandidate } from "@/lib/db/product-catalog-schema";
import {
  aggregateRecord,
  evidence,
  user,
  workspaceProjectEvidence,
  workspaceProjectItem,
  workspaceProjectMember,
} from "@/lib/db/schema";
import { verifyDocumentUploadBytes } from "./document-upload-bytes";
import { prepareProductAgentEvidenceSource } from "./evidence-locations";

const filenames: Record<string, string> = {
  "application/pdf": "source.pdf",
  "text/csv": "source.csv",
  "text/plain": "source.txt",
  "application/vnd.ms-excel": "source.xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "source.xlsx",
};
const fieldsSchema = z.object({
  source_ref: z.string(),
  field_evidence: z.record(z.string(), z.string()),
});

async function authorizedSources(
  projectId: string,
  productId: string,
  actorId: string,
  database: Database,
) {
  const [record] = await database
    .select({ payload: aggregateRecord.payload })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .innerJoin(
      workspaceProjectMember,
      and(
        eq(workspaceProjectMember.projectId, workspaceProjectItem.projectId),
        eq(workspaceProjectMember.userId, actorId),
      ),
    )
    .innerJoin(
      user,
      and(eq(user.id, actorId), eq(user.banned, false), inArray(user.role, ["admin", "user"])),
    )
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(aggregateRecord.id, productId),
        eq(aggregateRecord.type, "product"),
      ),
    )
    .limit(1);
  const parsed = fieldsSchema.safeParse(record?.payload);
  if (!parsed.success) return [];
  const fields = Object.entries(parsed.data.field_evidence);
  const rows = await database
    .select({
      id: evidence.id,
      label: evidence.sourceLabel,
      contentType: evidence.contentType,
      sha256: evidence.sha256,
      sizeBytes: evidence.sizeBytes,
      blobKey: evidence.blobKey,
    })
    .from(workspaceProjectEvidence)
    .innerJoin(evidence, eq(evidence.id, workspaceProjectEvidence.evidenceId))
    .where(eq(workspaceProjectEvidence.projectId, projectId));
  return rows.flatMap((row) => {
    if (!filenames[row.contentType]) return [];
    const linkedFields = fields.filter(
      ([, ref]) =>
        ref === row.id ||
        (parsed.data.source_ref === `source-${row.sha256}` && ref.startsWith("evidence-loc-")),
    );
    return linkedFields.length ? [{ ...row, linkedFields }] : [];
  });
}

export type ProductEvidencePreview = {
  id: string;
  label: string;
  href: string;
  contentType: string;
  fields: Array<{ path: string; reference: string; excerpt?: string }>;
};

export async function listProductEvidencePreviews(
  projectId: string,
  productId: string,
  actorId: string,
  database: Database = getDatabase(),
): Promise<ProductEvidencePreview[]> {
  const sources = await authorizedSources(projectId, productId, actorId, database);
  if (!sources.length) return [];
  // A retained catalog excerpt is displayed only when its exact reference matches the saved field.
  const [candidate] = await database
    .select({ source: productCatalogCandidate.source })
    .from(productCatalogCandidate)
    .where(eq(productCatalogCandidate.productId, productId))
    .limit(1);
  const excerpts = new Map<string, string>();
  if (candidate) {
    try {
      for (const location of prepareProductAgentEvidenceSource(candidate.source).evidence_locations)
        excerpts.set(location.ref, location.text);
    } catch {
      /* Legacy sources remain available as original files. */
    }
  }
  return sources.map((source) => ({
    id: source.id,
    label: source.label,
    contentType: source.contentType,
    href: `/api/product-evidence/${projectId}/${productId}/${encodeURIComponent(source.id)}`,
    fields: source.linkedFields.map(([path, reference]) => ({
      path,
      reference,
      ...(excerpts.has(reference) ? { excerpt: excerpts.get(reference) } : {}),
    })),
  }));
}

export async function readProductEvidence(
  projectId: string,
  productId: string,
  evidenceId: string,
  actorId: string,
  database: Database = getDatabase(),
  readBlob: typeof get = get,
) {
  const record = (await authorizedSources(projectId, productId, actorId, database)).find(
    (source) => source.id === evidenceId,
  );
  if (!record?.sizeBytes) return null;
  const blob = await readBlob(record.blobKey, { access: "private", useCache: false });
  if (blob?.statusCode !== 200 || !blob.stream || blob.blob.contentType !== record.contentType)
    return null;
  const filename = filenames[record.contentType];
  if (!filename) return null;
  const verified = await verifyDocumentUploadBytes(
    blob.stream,
    filename === "source.txt" ? "source.csv" : filename,
    record.sizeBytes,
  );
  if (
    verified.sha256 !== record.sha256 ||
    !(await authorizedSources(projectId, productId, actorId, database)).some(
      (source) =>
        source.id === evidenceId &&
        source.sha256 === record.sha256 &&
        source.blobKey === record.blobKey,
    )
  )
    return null;
  return {
    bytes: verified.bytes,
    filename,
    contentType: record.contentType,
    inline: ["application/pdf", "text/csv", "text/plain"].includes(record.contentType),
  };
}
