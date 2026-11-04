import { productTypeLabel, salesNextActionLabels } from "@/lib/sales/journey";
import type { TaskRecord } from "./task-model";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

/** Project membership is resolved by the store. References never widen that project's snapshot. */
export function workspaceTaskContext(record: TaskRecord, records: readonly TaskRecord[]) {
  const scoped = records.filter((row) => row.projectId === record.projectId);
  const find = (id: unknown, type: string) =>
    typeof id === "string" ? scoped.find((row) => row.id === id && row.type === type) : undefined;
  const lead =
    record.type === "lead"
      ? record
      : record.type === "delivery_confirmation" &&
          record.payload.related_entity_type === "opportunity"
        ? find(record.payload.related_entity_id, "lead")
        : undefined;
  const leadRfqs = lead
    ? scoped.filter(
        (row) =>
          row.type === "rfq" &&
          row.relation === "owned" &&
          (lead.payload.rfq_ref
            ? row.id === lead.payload.rfq_ref &&
              (!row.payload.lead_ref || row.payload.lead_ref === lead.id)
            : row.payload.lead_ref === lead.id),
      )
    : [];
  const rfq =
    record.type === "rfq"
      ? record
      : lead
        ? leadRfqs.length === 1
          ? leadRfqs[0]
          : undefined
        : record.type === "quotation"
          ? find(record.payload.rfq_id, "rfq")
          : record.type === "delivery_confirmation" && record.payload.related_entity_type === "rfq"
            ? find(record.payload.related_entity_id, "rfq")
            : undefined;
  const customer = object(rfq?.payload.customer);
  const customerLabel = [text(customer.company), text(customer.name)].filter(Boolean).join(" · ");
  const requested = object(rfq?.payload.product);
  const commercial = object(rfq?.payload.commercial);
  const type = text(requested.product_type);
  const need = [
    type ? productTypeLabel(type) : "",
    text(requested.required_specification),
    text(requested.oe_number) ? `OE ${text(requested.oe_number)}` : "",
    [text(requested.vehicle_brand), text(requested.vehicle_model)].filter(Boolean).join(" "),
    typeof commercial.quantity === "number" &&
    Number.isInteger(commercial.quantity) &&
    commercial.quantity > 0
      ? `数量 ${commercial.quantity}`
      : "",
    text(commercial.destination) ? `目的地 ${text(commercial.destination)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const productRecord =
    record.type === "product"
      ? record
      : find(record.payload.product_id ?? record.payload.productId, "product");
  const product = object(productRecord?.payload.product);
  const productLabel = [text(product.product_name), text(product.internal_sku)]
    .filter(Boolean)
    .join(" · ");
  return {
    ...(customerLabel ? { customerLabel } : {}),
    ...(need || productLabel ? { needLabel: need || productLabel } : {}),
    ...(lead && salesNextActionLabels[text(lead.payload.next_action)]
      ? { nextAction: salesNextActionLabels[text(lead.payload.next_action)] }
      : {}),
  };
}

export function isTaskOverdue(dueAt: Date | undefined, currentTime: number) {
  return Boolean(dueAt && Number.isFinite(dueAt.getTime()) && dueAt.getTime() <= currentTime);
}
export function formatTaskDeadline(dueAt: Date, timeZone: string) {
  if (!Number.isFinite(dueAt.getTime())) return "时间待核对";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(dueAt);
}
