import { applyInquiryMessage } from "./clarification";

export const INQUIRY_HISTORY_LIMIT = 30;
export const inquiryFieldLabels = {
  oeNumber: "OE 号码",
  vehicleBrand: "车辆品牌",
  vehicleModel: "车辆型号",
  quantity: "数量",
  destination: "目的地",
} as const;
export type InquiryField = keyof typeof inquiryFieldLabels;
export type InquiryFields = Partial<Record<InquiryField, string>>;
export type InquiryMessageInput = { id: string; body: string; receivedAt: string };

/** Customer requirements only; conflicting or ambiguous values stay manual. */
export function summarizeInquiryMessages(messages: readonly InquiryMessageInput[]) {
  const candidates = new Map<InquiryField, Map<string, { value: string; messageIds: string[] }>>();
  const uncertain = new Set<InquiryField>();
  for (const message of messages) {
    const draft = applyInquiryMessage({ product: {}, commercial: {} }, message.body);
    const fields: InquiryFields = {
      oeNumber: draft.product.oe_number,
      vehicleBrand: draft.product.vehicle_brand,
      vehicleModel: draft.product.vehicle_model,
      quantity: draft.commercial.quantity ? String(draft.commercial.quantity) : undefined,
      destination: draft.commercial.destination,
    };
    // Do not resurrect an earlier value when a later reply is an unsupported
    // range, alternative, or correction. The customer conversation remains the source.
    const mentions: Record<InquiryField, boolean> = {
      oeNumber: /\b(?:oe|oem)\s*[:#-]/i.test(message.body),
      vehicleBrand: /\b(?:Toyota|Honda|Ford|Volkswagen)\b/i.test(message.body),
      vehicleModel: /\b(?:Toyota|Honda|Ford|Volkswagen)\b/i.test(message.body),
      quantity: /\b(?:pcs?|pieces?)\b/i.test(message.body),
      destination: /\bdestination\s*[:=]/i.test(message.body),
    };
    const correction = /\b(?:not|wrong|incorrect|cancel|ignore|except|instead|no longer)\b/i.test(
      message.body,
    );
    for (const field of Object.keys(inquiryFieldLabels) as InquiryField[]) {
      const value = fields[field];
      if (mentions[field] && (!value || correction)) uncertain.add(field);
      if (!value) continue;
      const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
      const values = candidates.get(field) ?? new Map();
      const candidate = values.get(normalized) ?? { value, messageIds: [] };
      candidate.messageIds.push(message.id);
      values.set(normalized, candidate);
      candidates.set(field, values);
    }
  }
  const fields: InquiryFields = {};
  const fieldSources: Partial<Record<InquiryField, string[]>> = {};
  const conflicts: InquiryField[] = [];
  for (const field of Object.keys(inquiryFieldLabels) as InquiryField[]) {
    const values = candidates.get(field);
    if (uncertain.has(field) || (values?.size ?? 0) > 1) {
      conflicts.push(field);
    } else if (values?.size === 1) {
      const candidate = [...values.values()][0];
      fields[field] = candidate.value;
      fieldSources[field] = candidate.messageIds;
    }
  }
  return { fields, fieldSources, conflicts };
}
