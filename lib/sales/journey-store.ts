import "server-only";
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
) {
  const [rfqs, leads, quotations, deliveries] = await Promise.all([
    listProjectRfqEntries(projectId),
    listProjectLeads(projectId, actorId, undefined, { timelineLeadId }),
    listProjectQuotations(projectId),
    listProjectDeliveryConfirmations(projectId),
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
