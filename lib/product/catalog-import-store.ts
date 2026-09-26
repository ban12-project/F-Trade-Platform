import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { hasPermission } from "../authz";
import { type Database, type DatabaseTransaction, getDatabase } from "../db/client";
import {
  productCatalogAttempt as attempts,
  productCatalogCandidate as candidates,
  productCatalogImport as imports,
} from "../db/product-catalog-schema";
import {
  evidence,
  productDocumentUploadReceipt,
  session,
  user,
  workspaceProject,
} from "../db/schema";
import { insertProductAgentDraft } from "../products";
import { assertAndLinkProjectEvidence, assertWorkspaceProjectAccess } from "../workspace/access";
import type { ProductAgentResult } from "./agent";
import { finalizeProductAgentDraft } from "./agent";
import { discoverCatalogCandidates } from "./catalog-candidates";
import { preserveCatalogDraftIdentity } from "./catalog-draft-identity";
import {
  type CatalogFailureCode,
  type CatalogImportView,
  catalogIntakeSchema,
  catalogLookupSchema,
  catalogSelectionSchema,
} from "./catalog-import-contracts";
import type { ProductAgentDocumentSource } from "./document-source";
import { claimDocumentUpload } from "./document-upload-receipts";
import {
  assertProductAgentEvidenceLocations,
  compactProductAgentEvidenceRefs,
  prepareProductAgentEvidenceSource,
} from "./evidence-locations";

export type CatalogIdentity = { actorId: string; sessionId: string; projectId: string };
export type CatalogDispatch = { importId: string; attemptIds: string[] };
type ImportRow = typeof imports.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;

export class CatalogAccessError extends Error {}

async function authorize(
  tx: DatabaseTransaction,
  identity: CatalogIdentity,
  access: "view" | "write" = "write",
) {
  const [actor] = await tx
    .select({ role: user.role })
    .from(user)
    .innerJoin(session, eq(session.userId, user.id))
    .where(
      and(
        eq(user.id, identity.actorId),
        eq(user.banned, false),
        eq(session.id, identity.sessionId),
        gt(session.expiresAt, new Date()),
      ),
    )
    .for("share");
  if (!actor || !hasPermission(actor.role, "product:write"))
    throw new CatalogAccessError("产品导入会话或权限已失效。");
  // Project membership mutations take this same lock; check access after acquiring it.
  const [project] = await tx
    .select()
    .from(workspaceProject)
    .where(eq(workspaceProject.id, identity.projectId))
    .for("update");
  if (project?.kind !== "marketing" || (access === "write" && project.status !== "active"))
    throw new CatalogAccessError("目录导入需要进行中的营销项目。");
  try {
    await assertWorkspaceProjectAccess(identity.projectId, identity.actorId, access, tx);
  } catch {
    throw new CatalogAccessError("目录项目编辑权限已失效。");
  }
}

async function ownImport(
  tx: DatabaseTransaction,
  importId: string,
  identity: CatalogIdentity,
  access: "view" | "write" = "write",
) {
  await authorize(tx, identity, access);
  const [row] = await tx
    .select()
    .from(imports)
    .where(
      and(
        eq(imports.id, importId),
        eq(imports.projectId, identity.projectId),
        eq(imports.actorId, identity.actorId),
      ),
    )
    .for("update");
  if (!row) throw new Error("目录任务不存在或无权访问。");
  return row;
}

function live(attempt: AttemptRow | undefined) {
  return (
    attempt &&
    ["queued", "running"].includes(attempt.status) &&
    attempt.leaseExpiresAt.getTime() > Date.now()
  );
}

async function newAttempt(
  tx: DatabaseTransaction,
  row: ImportRow,
  identity: CatalogIdentity,
  candidateId: string | null = null,
  modelConfigId: string | null = null,
  model: string | null = null,
) {
  const id = randomUUID();
  await tx.insert(attempts).values({
    id,
    importId: row.id,
    candidateId,
    sessionId: identity.sessionId,
    modelConfigId,
    model,
    status: "queued",
    leaseExpiresAt: new Date(Date.now() + 30 * 60_000),
  });
  return id;
}

async function expireAttempt(tx: DatabaseTransaction, attempt: AttemptRow | undefined) {
  if (attempt && ["queued", "running"].includes(attempt.status) && !live(attempt)) {
    await tx
      .update(attempts)
      .set({ status: "failed", failureCode: "ATTEMPT_EXPIRED" })
      .where(eq(attempts.id, attempt.id));
  }
}

async function queueParsing(
  tx: DatabaseTransaction,
  row: ImportRow,
  identity: CatalogIdentity,
): Promise<CatalogDispatch> {
  if (row.status === "ready") return { importId: row.id, attemptIds: [] };
  const [previous] = row.activeAttemptId
    ? await tx.select().from(attempts).where(eq(attempts.id, row.activeAttemptId))
    : [];
  if (live(previous)) return { importId: row.id, attemptIds: [] };
  await expireAttempt(tx, previous);
  const id = await newAttempt(tx, row, identity);
  await tx
    .update(imports)
    .set({ status: "queued", activeAttemptId: id, failureCode: null })
    .where(eq(imports.id, row.id));
  return { importId: row.id, attemptIds: [id] };
}

export async function intakeCatalog(
  input: unknown,
  identity: CatalogIdentity,
  database: Database = getDatabase(),
  claim = claimDocumentUpload,
): Promise<CatalogDispatch> {
  const parsed = catalogIntakeSchema.parse(input);
  if (parsed.projectId !== identity.projectId) throw new Error("目录项目不匹配。");
  const existing = await database.transaction(async (tx) => {
    await authorize(tx, identity);
    const [row] = await tx.select().from(imports).where(eq(imports.receiptId, parsed.receiptId));
    if (!row) return null;
    if (row.actorId !== identity.actorId || row.projectId !== identity.projectId)
      throw new Error("上传回执归属不匹配。");
    return queueParsing(tx, row, identity);
  });
  if (existing) return existing;
  const claimed = await claim({ ...parsed, purpose: "agent" }, identity.actorId, database);
  return database.transaction(async (tx) => {
    await authorize(tx, identity);
    const [existingRow] = await tx
      .select()
      .from(imports)
      .where(eq(imports.receiptId, parsed.receiptId));
    if (existingRow) {
      if (existingRow.actorId !== identity.actorId || existingRow.projectId !== identity.projectId)
        throw new CatalogAccessError("上传回执归属不匹配。");
      return queueParsing(tx, existingRow, identity);
    }
    const [row] = await tx
      .insert(imports)
      .values({
        id: randomUUID(),
        projectId: identity.projectId,
        actorId: identity.actorId,
        receiptId: parsed.receiptId,
        evidenceId: claimed.evidenceId,
        status: "queued",
      })
      .returning();
    if (!row) throw new Error("目录任务创建失败。");
    return queueParsing(tx, row, identity);
  });
}

export async function retryCatalogParsing(
  input: unknown,
  identity: CatalogIdentity,
  database: Database = getDatabase(),
) {
  const parsed = catalogLookupSchema.parse(input);
  if (parsed.projectId !== identity.projectId) throw new Error("目录项目不匹配。");
  return database.transaction(async (tx) =>
    queueParsing(tx, await ownImport(tx, parsed.importId, identity), identity),
  );
}

export async function selectCatalogRecords(
  input: unknown,
  identity: CatalogIdentity,
  database: Database = getDatabase(),
): Promise<CatalogDispatch> {
  const parsed = catalogSelectionSchema.parse(input);
  if (parsed.projectId !== identity.projectId) throw new Error("目录项目不匹配。");
  return database.transaction(async (tx) => {
    const row = await ownImport(tx, parsed.importId, identity);
    if (row.status !== "ready") throw new Error("目录尚未解析完成。");
    const selected = await tx
      .select()
      .from(candidates)
      .where(and(eq(candidates.importId, row.id), inArray(candidates.id, parsed.candidateIds)))
      .orderBy(asc(candidates.ordinal));
    if (selected.length !== parsed.candidateIds.length) throw new Error("部分候选不属于当前目录。");
    const attemptIds: string[] = [];
    for (const candidate of selected) {
      if (candidate.status === "completed") continue;
      const [previous] = candidate.activeAttemptId
        ? await tx.select().from(attempts).where(eq(attempts.id, candidate.activeAttemptId))
        : [];
      if (live(previous)) continue;
      await expireAttempt(tx, previous);
      const id = await newAttempt(
        tx,
        row,
        identity,
        candidate.id,
        parsed.modelConfigId,
        parsed.model,
      );
      await tx
        .update(candidates)
        .set({ status: "queued", activeAttemptId: id, failureCode: null })
        .where(eq(candidates.id, candidate.id));
      attemptIds.push(id);
    }
    return { importId: row.id, attemptIds };
  });
}

export async function catalogImportView(
  input: unknown,
  identity: CatalogIdentity,
  database: Database = getDatabase(),
): Promise<CatalogImportView> {
  const parsed = catalogLookupSchema.parse(input);
  if (parsed.projectId !== identity.projectId) throw new Error("目录项目不匹配。");
  return database.transaction(async (tx) => {
    const row = await ownImport(tx, parsed.importId, identity, "view");
    const records = await tx
      .select()
      .from(candidates)
      .where(eq(candidates.importId, row.id))
      .orderBy(asc(candidates.ordinal));
    const history = await tx.select().from(attempts).where(eq(attempts.importId, row.id));
    const byId = new Map(history.map((attempt) => [attempt.id, attempt]));
    const expired = (id: string | null) =>
      id && ["queued", "running"].includes(byId.get(id)?.status ?? "") && !live(byId.get(id));
    return {
      id: row.id,
      status: expired(row.activeAttemptId) ? "failed" : row.status,
      failureCode: expired(row.activeAttemptId) ? "ATTEMPT_EXPIRED" : row.failureCode,
      candidates: records.map((record) => ({
        id: record.id,
        identifier: record.identifier,
        physicalPage: record.physicalPage,
        recordLine: record.recordLine,
        duplicateIdentifier: record.reviewStatus === "duplicate_identifier_review_required",
        status: expired(record.activeAttemptId) ? "failed" : record.status,
        attempts: history.filter((attempt) => attempt.candidateId === record.id).length,
        failureCode: expired(record.activeAttemptId) ? "ATTEMPT_EXPIRED" : record.failureCode,
        productId: record.productId,
      })),
    };
  });
}

export async function latestCatalogImport(
  projectId: string,
  identity: CatalogIdentity,
  database: Database = getDatabase(),
): Promise<CatalogImportView | null> {
  if (projectId !== identity.projectId) throw new Error("目录项目不匹配。");
  const id = await database.transaction(async (tx) => {
    await authorize(tx, identity, "view");
    const rows = await tx
      .select({ id: imports.id })
      .from(imports)
      .where(and(eq(imports.projectId, projectId), eq(imports.actorId, identity.actorId)))
      .orderBy(asc(imports.createdAt));
    return rows.at(-1)?.id;
  });
  return id ? catalogImportView({ projectId, importId: id }, identity, database) : null;
}

async function attemptContext(tx: DatabaseTransaction, attemptId: string) {
  const [initial] = await tx.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!initial) throw new Error("目录尝试不存在。");
  const [owner] = await tx.select().from(imports).where(eq(imports.id, initial.importId));
  if (!owner) throw new Error("目录任务不存在。");
  const identity = {
    actorId: owner.actorId,
    projectId: owner.projectId,
    sessionId: initial.sessionId,
  };
  const row = await ownImport(tx, owner.id, identity);
  // Refresh after locking: an earlier read may precede another worker's claim.
  const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!attempt) return null;
  const [candidate] = attempt.candidateId
    ? await tx
        .select()
        .from(candidates)
        .where(and(eq(candidates.id, attempt.candidateId), eq(candidates.importId, row.id)))
    : [];
  const currentId = attempt.candidateId ? candidate?.activeAttemptId : row.activeAttemptId;
  if (currentId !== attempt.id || !live(attempt)) return null;
  return { attempt, row, candidate, identity };
}

/** Internal worker entry. Duplicate deliveries cannot claim the same attempt twice. */
export async function claimCatalogAttempt(attemptId: string, database: Database = getDatabase()) {
  return database.transaction(async (tx) => {
    const context = await attemptContext(tx, attemptId);
    if (context?.attempt.status !== "queued") return null;
    const { attempt, row, candidate } = context;
    await tx
      .update(attempts)
      .set({
        status: "running",
        leaseExpiresAt: new Date(Date.now() + (candidate ? 3 : 12) * 60_000),
      })
      .where(eq(attempts.id, attempt.id));
    if (candidate)
      await tx.update(candidates).set({ status: "running" }).where(eq(candidates.id, candidate.id));
    else await tx.update(imports).set({ status: "parsing" }).where(eq(imports.id, row.id));
    await assertAndLinkProjectEvidence(row.projectId, [row.evidenceId], row.actorId, tx);
    const [original] = await tx.select().from(evidence).where(eq(evidence.id, row.evidenceId));
    const [receipt] = await tx
      .select()
      .from(productDocumentUploadReceipt)
      .where(eq(productDocumentUploadReceipt.id, row.receiptId));
    if (
      !original ||
      !receipt ||
      receipt.evidenceId !== original.id ||
      receipt.blobPath !== original.blobKey
    )
      throw new Error("目录原件关联无效。");
    return {
      attemptId: attempt.id,
      importId: row.id,
      projectId: row.projectId,
      modelConfigId: attempt.modelConfigId,
      model: attempt.model,
      source: candidate?.source ?? null,
      original: {
        evidenceId: original.id,
        blobPath: original.blobKey,
        filename: receipt.originalFilename,
        sha256: original.sha256,
        sizeBytes: original.sizeBytes,
        contentType: original.contentType,
      },
    };
  });
}

export async function completeCatalogParsing(
  attemptId: string,
  document: ProductAgentDocumentSource,
  database: Database = getDatabase(),
) {
  return database.transaction(async (tx) => {
    const context = await attemptContext(tx, attemptId);
    if (!context || context.attempt.candidateId || context.attempt.status !== "running")
      return false;
    const { row } = context;
    const [original] = await tx.select().from(evidence).where(eq(evidence.id, row.evidenceId));
    if (!original || document.document_sha256 !== original.sha256)
      throw new Error("目录解析摘要与原件不一致。");
    const source = {
      ...document.source,
      record_id: row.id,
      source_ref: `source-${original.sha256}`,
      evidence_refs: [row.evidenceId],
    };
    const discovered = discoverCatalogCandidates(source);
    if (discovered.length)
      await tx.insert(candidates).values(
        discovered.map((candidate, ordinal) => {
          const location = candidate.source.evidence_refs[0];
          if (!location) throw new Error("目录候选缺少来源位置。");
          const recordLine = Number(/record-line=(\d+)/.exec(location)?.[1]);
          const page = /(?:#|&)pdf-page=(\d+)/.exec(location)?.[1];
          const id = randomUUID();
          return {
            id,
            importId: row.id,
            ordinal,
            identifier: candidate.identifier,
            source: { ...candidate.source, record_id: id },
            physicalPage: page ? Number(page) : null,
            recordLine,
            reviewStatus: candidate.review_status,
          };
        }),
      );
    await tx
      .update(imports)
      .set({ status: "ready", failureCode: null })
      .where(eq(imports.id, row.id));
    await tx.update(attempts).set({ status: "completed" }).where(eq(attempts.id, attemptId));
    return true;
  });
}

export async function completeCatalogCandidate(
  attemptId: string,
  result: ProductAgentResult,
  database: Database = getDatabase(),
) {
  return database.transaction(async (tx) => {
    const context = await attemptContext(tx, attemptId);
    if (!context?.candidate || context.attempt.status !== "running") return false;
    const { row, candidate, identity } = context;
    const source = prepareProductAgentEvidenceSource(candidate.source);
    const identityDraft = preserveCatalogDraftIdentity(result.draft, source, candidate.identifier);
    const validated = finalizeProductAgentDraft(
      { ...identityDraft.draft, evidence_refs: source.evidence_refs },
      source,
    );
    assertProductAgentEvidenceLocations(validated, source, finalizeProductAgentDraft);
    if (validated.record_id !== candidate.id || validated.verification_status !== "review_required")
      throw new Error("候选草稿身份或审核状态无效。");
    const saved = await insertProductAgentDraft(
      tx,
      compactProductAgentEvidenceRefs(validated),
      identity.actorId,
      {
        ...result.metadata,
        catalog_import_id: row.id,
        catalog_candidate_id: candidate.id,
        catalog_attempt_id: attemptId,
        original_evidence_id: row.evidenceId,
        catalog_identifier_preserved: identityDraft.preserved,
      },
      row.projectId,
    );
    await tx
      .update(candidates)
      .set({ status: "completed", productId: saved.id, failureCode: null })
      .where(eq(candidates.id, candidate.id));
    await tx.update(attempts).set({ status: "completed" }).where(eq(attempts.id, attemptId));
    return true;
  });
}

/** Failure recording cannot read source data or create a product, even after access is revoked. */
export async function failCatalogAttempt(
  attemptId: string,
  failureCode: CatalogFailureCode,
  database: Database = getDatabase(),
) {
  await database.transaction(async (tx) => {
    const [initial] = await tx.select().from(attempts).where(eq(attempts.id, attemptId));
    if (!initial) return;
    const [row] = await tx
      .select()
      .from(imports)
      .where(eq(imports.id, initial.importId))
      .for("update");
    if (!row) return;
    const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, attemptId));
    if (!attempt || !["queued", "running"].includes(attempt.status)) return;
    await tx
      .update(attempts)
      .set({ status: "failed", failureCode })
      .where(eq(attempts.id, attemptId));
    if (attempt.candidateId)
      await tx
        .update(candidates)
        .set({ status: "failed", failureCode })
        .where(
          and(eq(candidates.id, attempt.candidateId), eq(candidates.activeAttemptId, attemptId)),
        );
    else
      await tx
        .update(imports)
        .set({ status: "failed", failureCode })
        .where(and(eq(imports.id, row.id), eq(imports.activeAttemptId, attemptId)));
  });
}

export async function attachCatalogWorkflow(
  attemptIds: string[],
  workflowRunId: string,
  database: Database = getDatabase(),
) {
  if (attemptIds.length)
    await database.update(attempts).set({ workflowRunId }).where(inArray(attempts.id, attemptIds));
}
