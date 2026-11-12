import type { QuotationEntry } from "@/lib/sales/closing-store";
import type { RfqEntry } from "@/lib/sales/store";
import type { WorkspaceProductReference } from "@/lib/workspace/types";

type PreviewEntry = Pick<
  QuotationEntry,
  "id" | "version" | "state" | "quotation" | "productId" | "approvalId" | "approvalStatus"
>;

/** Read-only formatting: never generates terms, sends messages, or records delivery. */
export function buildApprovedQuotationPreview(
  entry: PreviewEntry,
  rfqs: readonly RfqEntry[],
  products: readonly WorkspaceProductReference[],
) {
  if (
    entry.state !== "QUOTE_APPROVED" ||
    entry.quotation.status !== "approved" ||
    entry.approvalStatus !== "approved" ||
    !entry.approvalId ||
    entry.approvalId !== entry.quotation.approval_ref ||
    entry.id !== entry.quotation.handoff_id ||
    !Number.isSafeInteger(entry.version) ||
    entry.version < 1
  )
    return null;

  const rfq = rfqs.find((item) => item.id === entry.quotation.rfq_id);
  const product = products.find(
    (item) => item.id === entry.productId && item.id === entry.quotation.product_id,
  );
  const quote = entry.quotation.quote;
  const unknown = "Not recorded; please confirm";
  const customer = rfq?.formValues.customerName.trim() || unknown;
  const company = rfq?.formValues.customerCompany.trim() || unknown;
  const productName = product?.productName.trim() || unknown;
  const sku = product?.internalSku.trim() || unknown;
  const quantity =
    rfq?.quantity !== null && rfq?.quantity !== undefined ? String(rfq.quantity) : unknown;

  // RFQ quantity is a customer request, not an approved order quantity. The legacy
  // contract has a validity duration but no start/expiry date or quantity unit.
  // Do not derive dates from creation/approval or invent a unit, total, or promise.
  const text = [
    "QUOTATION",
    `Reference: ${entry.id}`,
    `Approved quotation record version: ${entry.version}`,
    "",
    "Linked inquiry and product information (please verify before sending)",
    `Customer: ${customer}`,
    `Company: ${company}`,
    `Product: ${productName}`,
    `Product code: ${sku}`,
    `Requested quantity: ${quantity}`,
    "Quantity unit: Not recorded in quotation; please confirm",
    "",
    "Human-approved commercial terms",
    `Unit price: ${quote.currency} ${quote.unit_price}`,
    `Minimum order quantity: ${quote.moq}`,
    `Lead time: ${quote.lead_time_days} days`,
    `Payment terms: ${quote.payment_terms}`,
    `Validity period: ${quote.validity_days} days`,
    "Validity start / expiry date: Not recorded; please confirm before sending",
  ].join("\n");

  return { text, version: entry.version };
}
