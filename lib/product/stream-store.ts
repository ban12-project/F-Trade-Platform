import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { type Database, type DatabaseTransaction, getDatabase } from "../db/client";
import {
  aggregateRecord,
  auditEvent,
  productAgentStreamRun,
  session,
  user,
  workspaceProject,
  workspaceProjectMember,
} from "../db/schema";
import { insertProductAgentDraft } from "../products";
import { assertAndLinkProjectEvidence } from "../workspace/access";
import type { ProductAgentSource } from "./agent";
import { prepareProductAgentEvidenceSource } from "./evidence-locations";
import { emptyProductStreamDraft } from "./stream-validation";
import { type ProductDraft, reviewProductDraft } from "./verification";

export interface ProductStreamIdentity {
  actorId: string;
  sessionId: string;
  projectId: string;
}

/** Lock current authorization rows until the write commits, including session revocation. */
export async function authorizeProductStreamWrite(
  tx: DatabaseTransaction,
  identity: ProductStreamIdentity,
) {
  const [authorized] = await tx
    .select({ id: user.id })
    .from(user)
    .innerJoin(session, eq(session.userId, user.id))
    .where(
      and(
        eq(user.id, identity.actorId),
        eq(user.role, "admin"),
        eq(user.banned, false),
        eq(session.id, identity.sessionId),
        gt(session.expiresAt, new Date()),
      ),
    )
    .for("share");
  if (!authorized) throw new Error("管理员会话已失效或权限已变更。");
  const [member] = await tx
    .select({ id: workspaceProjectMember.id })
    .from(workspaceProjectMember)
    .innerJoin(workspaceProject, eq(workspaceProject.id, workspaceProjectMember.projectId))
    .where(
      and(
        eq(workspaceProject.id, identity.projectId),
        eq(workspaceProject.kind, "marketing"),
        eq(workspaceProjectMember.userId, identity.actorId),
        inArray(workspaceProjectMember.role, ["owner", "editor"]),
      ),
    )
    .for("share");
  if (!member) throw new Error("当前项目编辑权限已失效。");
}

export async function startProductStreamRun(
  identity: ProductStreamIdentity,
  source: ProductAgentSource,
  modelMetadata: Record<string, string>,
  database: Database = getDatabase(),
) {
  const runId = randomUUID();
  const draft = emptyProductStreamDraft(prepareProductAgentEvidenceSource(source));
  return database.transaction(async (tx) => {
    await authorizeProductStreamWrite(tx, identity);
    await assertAndLinkProjectEvidence(
      identity.projectId,
      source.evidence_refs,
      identity.actorId,
      tx,
    );
    const saved = await insertProductAgentDraft(
      tx,
      draft,
      identity.actorId,
      { ...modelMetadata, stream_run_id: runId },
      identity.projectId,
    );
    await tx.insert(productAgentStreamRun).values({
      id: runId,
      productId: saved.id,
      ...identity,
      status: "running",
      modelMetadata,
      expiresAt: new Date(Date.now() + 120_000),
    });
    return { runId, productId: saved.id };
  });
}

export async function persistProductStreamDraft(
  identity: ProductStreamIdentity,
  runId: string,
  draft: ProductDraft,
  database: Database = getDatabase(),
) {
  return database.transaction(async (tx) => {
    await authorizeProductStreamWrite(tx, identity);
    const [run] = await tx
      .select()
      .from(productAgentStreamRun)
      .where(eq(productAgentStreamRun.id, runId))
      .for("update");
    if (
      !run ||
      run.actorId !== identity.actorId ||
      run.sessionId !== identity.sessionId ||
      run.projectId !== identity.projectId ||
      run.productId !== draft.record_id ||
      run.status !== "running" ||
      run.expiresAt <= new Date()
    )
      throw new Error("生成任务已结束或不属于当前会话。");
    const [aggregate] = await tx
      .select()
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, run.productId))
      .for("update");
    if (
      !aggregate ||
      aggregate.state !== "PRODUCT_REVIEW_REQUIRED" ||
      draft.verification_status !== "review_required"
    )
      throw new Error("仅待审草稿允许追加生成字段。");
    const previous = aggregate.payload as unknown as ProductDraft;
    if (previous.source_ref !== draft.source_ref) throw new Error("生成来源不可更换。");
    for (const [path, evidenceRef] of Object.entries(previous.field_evidence)) {
      const [section, field] = path.split(".") as [
        "product" | "specifications" | "commercial",
        string,
      ];
      if (
        draft.field_evidence[path] !== evidenceRef ||
        JSON.stringify(previous[section]?.[field]) !== JSON.stringify(draft[section]?.[field])
      )
        throw new Error("已保存字段不可被流式输出覆盖。");
    }
    const checked = reviewProductDraft(draft);
    await tx
      .update(aggregateRecord)
      .set({
        payload: checked as unknown as Record<string, unknown>,
        version: sql`${aggregateRecord.version} + 1`,
      })
      .where(eq(aggregateRecord.id, run.productId));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "product_agent_stream_fields_saved",
      actorType: "agent",
      actorId: "product_agent",
      aggregateId: run.productId,
      subjectType: "product",
      subjectId: run.productId,
      metadata: {
        run_id: runId,
        requested_by: identity.actorId,
        version: aggregate.version + 1,
        fields: Object.keys(draft.field_evidence).filter(
          (field) => !Object.hasOwn(previous.field_evidence, field),
        ),
      },
      occurredAt: new Date(),
    });
    return { productId: run.productId, version: aggregate.version + 1 };
  });
}

/** Lifecycle-only cleanup may follow revocation; it cannot write facts or promote a product. */
export async function finishProductStreamRun(
  identity: ProductStreamIdentity,
  runId: string,
  status: "completed" | "failed" | "interrupted",
  database: Database = getDatabase(),
) {
  await database.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(productAgentStreamRun)
      .where(eq(productAgentStreamRun.id, runId))
      .for("update");
    if (
      !run ||
      run.actorId !== identity.actorId ||
      run.sessionId !== identity.sessionId ||
      run.projectId !== identity.projectId
    )
      throw new Error("生成任务不属于当前会话。");
    if (run.status !== "running") return;
    await tx
      .update(productAgentStreamRun)
      .set({ status })
      .where(eq(productAgentStreamRun.id, runId));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "product_agent_stream_finished",
      actorType: "system",
      actorId: "product_stream_runtime",
      aggregateId: run.productId,
      subjectType: "product",
      subjectId: run.productId,
      metadata: { run_id: runId, status },
      occurredAt: new Date(),
    });
  });
}
