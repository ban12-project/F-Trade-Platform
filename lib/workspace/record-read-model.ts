import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { cache } from "react";
import { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  approval,
  socialChannelControl,
  socialPublication,
  workspaceProjectItem,
} from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "./access";
import type { WorkspaceRecordKind } from "./navigation";
import { getWorkspaceProject } from "./store";
import { deriveWorkspaceTasks, type TaskRecord, type WorkspaceTaskSnapshot } from "./task-model";

export const readWorkspaceRecord = cache(
  async (projectId: string, kind: WorkspaceRecordKind, id: string, actorId: string) => {
    await assertWorkspaceProjectAccess(projectId, actorId, "view");
    const database = getDatabase();
    if (kind === "publication") {
      const [publication] = await database
        .select()
        .from(socialPublication)
        .where(and(eq(socialPublication.id, id), eq(socialPublication.projectId, projectId)))
        .limit(1);
      return publication
        ? {
            id: publication.id,
            state: publication.status,
            relation: "owned",
            publication,
            record: null,
          }
        : null;
    }
    const [row] = await database
      .select({ record: aggregateRecord, relation: workspaceProjectItem.relation })
      .from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(
        and(
          eq(workspaceProjectItem.projectId, projectId),
          eq(aggregateRecord.id, id),
          eq(aggregateRecord.type, kind === "delivery" ? "delivery_confirmation" : kind),
        ),
      )
      .limit(1);
    return row
      ? {
          id: row.record.id,
          state: row.record.state,
          relation: row.relation,
          record: row.record,
          publication: null,
        }
      : null;
  },
);

// Read only the current object, its explicit source/dependants, and its own approvals/receipts.
export const readWorkspaceRecordTasks = cache(
  async (projectId: string, kind: WorkspaceRecordKind, id: string, actorId: string) => {
    const [current, project] = await Promise.all([
      readWorkspaceRecord(projectId, kind, id, actorId),
      getWorkspaceProject(projectId, actorId),
    ]);
    if (!current || !project || !current.record) return [];
    const record = current.record;
    const payload = record.payload;
    const refs = [
      "product_id",
      "productId",
      "rfq_id",
      "rfq_ref",
      "lead_ref",
      "quotation_ref",
      "delivery_confirmation_ref",
    ].flatMap((key) => (z.uuid().safeParse(payload[key]).success ? [payload[key] as string] : []));
    const database = getDatabase();
    const [neighbors, approvals, publications, channels, readyProducts] = await Promise.all([
      database
        .select({
          id: aggregateRecord.id,
          projectId: workspaceProjectItem.projectId,
          type: aggregateRecord.type,
          state: aggregateRecord.state,
          version: aggregateRecord.version,
          payload: aggregateRecord.payload,
          relation: workspaceProjectItem.relation,
          createdAt: aggregateRecord.createdAt,
          updatedAt: aggregateRecord.updatedAt,
        })
        .from(workspaceProjectItem)
        .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
        .where(
          and(
            eq(workspaceProjectItem.projectId, projectId),
            or(
              inArray(aggregateRecord.id, [id, ...refs]),
              sql`${aggregateRecord.payload}->>'product_id' = ${id}`,
              sql`${aggregateRecord.payload}->>'productId' = ${id}`,
              sql`${aggregateRecord.payload}->>'rfq_id' = ${id}`,
              sql`${aggregateRecord.payload}->>'lead_ref' = ${id}`,
            ),
          ),
        ),
      database
        .select({
          id: approval.id,
          aggregateId: approval.aggregateId,
          gate: approval.gate,
          status: approval.status,
          requestedAt: approval.requestedAt,
          createdAt: approval.createdAt,
        })
        .from(approval)
        .where(eq(approval.aggregateId, id)),
      database
        .select({
          id: socialPublication.id,
          projectId: socialPublication.projectId,
          contentRef: socialPublication.contentRef,
          status: socialPublication.status,
          createdAt: socialPublication.createdAt,
        })
        .from(socialPublication)
        .where(
          and(eq(socialPublication.projectId, projectId), eq(socialPublication.contentRef, id)),
        ),
      database
        .select({ id: socialChannelControl.id })
        .from(socialChannelControl)
        .where(
          and(
            eq(socialChannelControl.enabled, true),
            eq(socialChannelControl.circuitStatus, "active"),
          ),
        )
        .limit(1),
      // RFQ task eligibility needs only one authorized ready reference, not the product catalog.
      record.type === "rfq"
        ? database
            .select({
              id: aggregateRecord.id,
              projectId: workspaceProjectItem.projectId,
              type: aggregateRecord.type,
              state: aggregateRecord.state,
              version: aggregateRecord.version,
              payload: aggregateRecord.payload,
              relation: workspaceProjectItem.relation,
              createdAt: aggregateRecord.createdAt,
              updatedAt: aggregateRecord.updatedAt,
            })
            .from(workspaceProjectItem)
            .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
            .where(
              and(
                eq(workspaceProjectItem.projectId, projectId),
                eq(aggregateRecord.type, "product"),
                eq(aggregateRecord.state, "PRODUCT_READY"),
              ),
            )
            .limit(1)
        : [],
    ]);
    // Project role and application role have the same meaning as the dashboard projection.
    const { user } = await import("@/lib/db/schema");
    const [actor] = await database
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, actorId));
    const snapshot: WorkspaceTaskSnapshot = {
      projects: [{ ...project, memberRole: project.memberRole!, appRole: actor?.role ?? null }],
      records: [
        ...neighbors,
        ...readyProducts.filter((item) => !neighbors.some((neighbor) => neighbor.id === item.id)),
      ] as TaskRecord[],
      approvals,
      publications,
      hasActiveChannel: channels.length > 0,
    };
    return deriveWorkspaceTasks(snapshot, new Date()).filter((task) => {
      const destination = task.destination;
      return (
        task.source?.id === id ||
        (destination.type === "record" &&
          (destination.id === id || publications.some((row) => row.id === destination.id)))
      );
    });
  },
);
