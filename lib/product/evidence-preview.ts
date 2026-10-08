import "server-only";
import { get } from "@vercel/blob";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type Database, getDatabase } from "@/lib/db/client";
import { productCatalogCandidate, productCatalogImport } from "@/lib/db/product-catalog-schema";
import {
  aggregateRecord,
  auditEvent,
  evidence,
  productDocumentUploadReceipt,
  user,
  workspaceProjectEvidence,
  workspaceProjectItem,
  workspaceProjectMember,
} from "@/lib/db/schema";
import { verifyDocumentUploadBytes } from "./document-upload-bytes";
import {
  type ProductAgentEvidenceLocation,
  prepareProductAgentEvidenceSource,
} from "./evidence-locations";
import { parseProductEvidenceSourceBinding } from "./evidence-source-binding";

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
  // Generated location IDs are opaque. Use the association recorded by the server,
  // never a caller's source label or another upload with matching bytes.
  const [created] = await database
    .select({ metadata: auditEvent.metadata })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.aggregateId, productId),
        eq(auditEvent.subjectType, "product"),
        eq(auditEvent.subjectId, productId),
        eq(auditEvent.action, "product_agent_draft_created"),
        eq(auditEvent.actorType, "agent"),
        eq(auditEvent.actorId, "product_agent"),
      ),
    )
    .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
    .limit(1);
  const binding = parseProductEvidenceSourceBinding(created?.metadata.source_evidence_binding);
  const hasRecordedBinding = created?.metadata.source_evidence_binding !== undefined;
  const rows = await database
    .select({
      id: evidence.id,
      label: sql<string>`coalesce(${productDocumentUploadReceipt.originalFilename}, ${evidence.sourceLabel})`,
      contentType: evidence.contentType,
      sha256: evidence.sha256,
      sizeBytes: evidence.sizeBytes,
      blobKey: evidence.blobKey,
    })
    .from(workspaceProjectEvidence)
    .innerJoin(evidence, eq(evidence.id, workspaceProjectEvidence.evidenceId))
    .leftJoin(
      productDocumentUploadReceipt,
      and(
        eq(productDocumentUploadReceipt.blobPath, evidence.blobKey),
        eq(productDocumentUploadReceipt.evidenceId, evidence.id),
        eq(productDocumentUploadReceipt.ownerId, evidence.uploadedById),
        eq(evidence.uploadedByType, "human"),
      ),
    )
    .where(eq(workspaceProjectEvidence.projectId, projectId));
  return rows.flatMap((row) => {
    if (!filenames[row.contentType]) return [];
    const linkedFields = fields.filter(
      ([, ref]) =>
        ref === row.id ||
        (binding?.source_ref === parsed.data.source_ref &&
          binding.evidence_ref === row.id &&
          binding.location_refs.includes(ref)) ||
        (!hasRecordedBinding &&
          parsed.data.source_ref === `source-${row.sha256}` &&
          ref.startsWith("evidence-loc-")),
    );
    return linkedFields.length ? [{ ...row, linkedFields }] : [];
  });
}

export type ProductEvidencePreview = {
  id: string;
  label: string;
  href: string;
  contentType: string;
  fields: Array<{
    path: string;
    reference: string;
    excerpt?: string;
    location?: { physicalPage?: number; recordLine: number };
  }>;
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
    .select({
      source: productCatalogCandidate.source,
      physicalPage: productCatalogCandidate.physicalPage,
      recordLine: productCatalogCandidate.recordLine,
      evidenceId: productCatalogImport.evidenceId,
    })
    .from(productCatalogCandidate)
    .innerJoin(productCatalogImport, eq(productCatalogImport.id, productCatalogCandidate.importId))
    .where(eq(productCatalogCandidate.productId, productId))
    .limit(1);
  const locations = new Map<string, ProductAgentEvidenceLocation>();
  if (candidate) {
    try {
      for (const location of prepareProductAgentEvidenceSource(candidate.source).evidence_locations)
        locations.set(location.ref, location);
    } catch {
      /* Legacy sources remain available as original files. */
    }
  }
  return sources.map((source) => ({
    id: source.id,
    label: source.label,
    contentType: source.contentType,
    href: `/api/product-evidence/${projectId}/${productId}/${encodeURIComponent(source.id)}`,
    fields: source.linkedFields.map(([path, reference]) => {
      const retained = locations.get(reference);
      // A shared byte hash alone cannot associate a separate upload with a catalog record.
      const bound =
        retained &&
        candidate?.evidenceId === source.id &&
        candidate.source.source_ref === `source-${source.sha256}` &&
        (retained.source_ref === source.id || retained.source_ref.startsWith(`${source.id}#`));
      const physicalPage = candidate?.physicalPage ?? null;
      const recordLine = candidate?.recordLine ?? 0;
      const expectedRef = `${source.id}#${physicalPage ? `pdf-page=${physicalPage}&` : ""}record-line=${recordLine}`;
      const located =
        bound &&
        Number.isSafeInteger(recordLine) &&
        recordLine > 0 &&
        (physicalPage === null ||
          (source.contentType === "application/pdf" &&
            Number.isSafeInteger(physicalPage) &&
            physicalPage > 0)) &&
        candidate.source.evidence_refs.length === 1 &&
        candidate.source.evidence_refs[0] === expectedRef &&
        retained.source_ref === expectedRef;
      return {
        path,
        reference,
        ...(bound ? { excerpt: retained.text } : {}),
        ...(located
          ? {
              location: {
                recordLine,
                ...(physicalPage ? { physicalPage } : {}),
              },
            }
          : {}),
      };
    }),
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
