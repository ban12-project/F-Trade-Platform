import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import { aggregateRecord, workspaceProjectItem } from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import {
  listProjectDeliveryConfirmations,
  listProjectLeads,
  listProjectQuotations,
} from "./closing-store";
import type { SalesRelationRecord } from "./journey";
import { listProjectRfqEntries } from "./store";

export async function readSalesJourney(
  projectId: string,
  actorId: string,
  timelineLeadId?: string,
  selection?: { kind: SalesRelationRecord["kind"]; id: string },
) {
  await assertWorkspaceProjectAccess(projectId, actorId, "view");
  const database = getDatabase();
  let ids: string[] | undefined;
  if (selection) {
    const [current] = await database
      .select({
        id: aggregateRecord.id,
        type: aggregateRecord.type,
        payload: aggregateRecord.payload,
      })
      .from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(
        and(
          eq(workspaceProjectItem.projectId, projectId),
          eq(aggregateRecord.id, selection.id),
          eq(
            aggregateRecord.type,
            selection.kind === "delivery" ? "delivery_confirmation" : selection.kind,
          ),
        ),
      )
      .limit(1);
    const wanted = new Set<string>();
    const visited = new Set<string>();
    const found = new Set<string>();
    const keys = [
      "rfq_id",
      "rfq_ref",
      "lead_ref",
      "quotation_ref",
      "delivery_confirmation_ref",
      "related_entity_id",
    ];
    const collectRefs = (payload: Record<string, unknown>) => {
      for (const key of keys) {
        const value = payload[key];
        if (typeof value === "string" && z.uuid().safeParse(value).success) wanted.add(value);
      }
    };
    if (current) {
      wanted.add(current.id);
      collectRefs(current.payload);
    }
    while ([...wanted].some((id) => !visited.has(id))) {
      const seeds = [...wanted].filter((id) => !visited.has(id));
      for (const id of seeds) visited.add(id);
      const related = await database
        .select({ id: aggregateRecord.id, payload: aggregateRecord.payload })
        .from(workspaceProjectItem)
        .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
        .where(
          and(
            eq(workspaceProjectItem.projectId, projectId),
            inArray(aggregateRecord.type, ["rfq", "quotation", "lead", "delivery_confirmation"]),
            or(
              inArray(aggregateRecord.id, seeds),
              ...keys.map((key) =>
                inArray(sql<string>`${aggregateRecord.payload}->>${key}`, seeds),
              ),
            ),
          ),
        );
      for (const row of related) {
        found.add(row.id);
        wanted.add(row.id);
        collectRefs(row.payload);
      }
    }
    ids = [...found];
  }
  const [rfqs, leads, quotations, deliveries] = await Promise.all([
    listProjectRfqEntries(projectId, ids),
    listProjectLeads(projectId, actorId, undefined, { timelineLeadId, ids }),
    listProjectQuotations(projectId, undefined, ids),
    listProjectDeliveryConfirmations(projectId, undefined, ids),
  ]);
  const records: SalesRelationRecord[] = [
    ...rfqs.map(
      (entry): SalesRelationRecord => ({
        id: entry.id,
        kind: "rfq",
        state: entry.state,
        title: `${entry.formValues.customerName || "客户需求"} · ${entry.quantity ?? "数量待补"}`,
        leadId: entry.formValues.leadId || undefined,
      }),
    ),
    ...leads.map(
      (entry): SalesRelationRecord => ({
        id: entry.id,
        kind: "lead",
        state: entry.state,
        title: `客户会话 ${entry.id.slice(0, 8)}`,
        rfqId: entry.lead.rfq_ref,
        quotationId: entry.lead.quotation_ref,
        deliveryId: entry.lead.delivery_confirmation_ref,
      }),
    ),
    ...quotations.map(
      (entry): SalesRelationRecord => ({
        id: entry.id,
        kind: "quotation",
        state: entry.state,
        title: `报价 ${entry.quotation.quote.currency} ${entry.quotation.quote.unit_price} · ${entry.id.slice(0, 8)}`,
        rfqId: entry.quotation.rfq_id,
      }),
    ),
    ...deliveries.map(
      (entry): SalesRelationRecord => ({
        id: entry.id,
        kind: "delivery",
        state: entry.state,
        title: `交期确认 ${entry.id.slice(0, 8)}`,
        rfqId:
          entry.confirmation.related_entity_type === "rfq" &&
          typeof entry.confirmation.related_entity_id === "string"
            ? entry.confirmation.related_entity_id
            : undefined,
      }),
    ),
  ];
  return { rfqs, leads, quotations, deliveries, records };
}
