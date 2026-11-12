import type { TaskRecord, WorkspaceTaskSnapshot } from "../../lib/workspace/task-model";

const date = new Date("2026-11-01T12:00:00Z");
export const libraryIds = {
  first: "00000000-0000-4000-8000-000000000901",
  second: "00000000-0000-4000-8000-000000000902",
  empty: "00000000-0000-4000-8000-000000000903",
  product: "00000000-0000-4000-8000-000000000911",
  rfq: "00000000-0000-4000-8000-000000000912",
  lead: "00000000-0000-4000-8000-000000000913",
};
function record(
  id: string,
  type: string,
  state: string,
  payload: Record<string, unknown>,
  projectId = libraryIds.first,
): TaskRecord {
  return {
    id,
    projectId,
    type,
    state,
    payload,
    version: 1,
    relation: "owned",
    createdAt: date,
    updatedAt: date,
  };
}
export const librarySnapshot: WorkspaceTaskSnapshot = {
  projects: [libraryIds.first, libraryIds.second, libraryIds.empty].map((id, index) => ({
    id,
    title: `Synthetic project ${index + 1}`,
    kind: "sales",
    status: "active",
    updatedAt: date,
    memberRole: "editor",
    appRole: "admin",
  })),
  records: [
    record(libraryIds.product, "product", "PRODUCT_READY", {
      product: {
        product_name: "Synthetic clutch kit",
        internal_sku: "SYN-CLUTCH-001",
        oe_numbers: ["SYN-OE-1001", "SYN-OE-1002"],
      },
      private_note: "excluded-source-note",
    }),
    record(libraryIds.rfq, "rfq", "RFQ_COLLECTING", {
      customer: {
        name: "Synthetic Alice",
        company: "Synthetic Example Parts",
        email: "excluded-contact@example.invalid",
      },
      product: { oe_number: "SYN-OE-1001" },
    }),
    record(libraryIds.lead, "lead", "FOLLOW_UP", { rfq_ref: libraryIds.rfq }),
    record("00000000-0000-4000-8000-000000000914", "quotation", "QUOTE_DRAFT", {
      rfq_id: libraryIds.rfq,
      product_id: libraryIds.product,
      quote: { unit_price: 123 },
    }),
    record(
      "00000000-0000-4000-8000-000000000915",
      "delivery_confirmation",
      "DELIVERY_CONFIRMATION_PENDING",
      { related_entity_type: "opportunity", related_entity_id: libraryIds.lead },
    ),
    record("00000000-0000-4000-8000-000000000916", "content", "CONTENT_DRAFT", {
      hook: "Synthetic content",
      product_id: libraryIds.product,
    }),
    record("00000000-0000-4000-8000-000000000917", "video", "VIDEO_DRAFT", {
      objective: "Synthetic video",
      productId: libraryIds.product,
    }),
    record(
      "00000000-0000-4000-8000-000000000921",
      "product",
      "PRODUCT_DRAFT",
      { product: { product_name: "Synthetic bearing", internal_sku: "SYN-BEARING-002" } },
      libraryIds.second,
    ),
    record(
      "00000000-0000-4000-8000-000000000922",
      "rfq",
      "RFQ_READY",
      { customer: { name: "Synthetic Bob", company: "Synthetic Other Parts" } },
      libraryIds.second,
    ),
  ],
  approvals: [],
  publications: [],
  hasActiveChannel: false,
};
