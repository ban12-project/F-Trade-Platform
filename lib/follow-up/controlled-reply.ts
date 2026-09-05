import type { DeliveryConfirmation } from "@/lib/delivery/confirmation";

export type FollowUpContext =
  | "quote_sent_unread"
  | "quote_sent_read_no_reply"
  | "price_high"
  | "purchase_later"
  | "asks_sample"
  | "asks_lead_time";

const DELIVERY_CLAIM_PATTERN =
  /(?:交期|货期|发货时间|lead\s*time|delivery\s+(?:in|within|after|before)|ship(?:s|ping)?\s+(?:in|within|after|before))/iu;

export class ControlledReplyError extends Error {
  constructor(
    readonly code:
      | "delivery_claim_in_draft"
      | "gate_03_missing"
      | "gate_03_not_confirmed"
      | "gate_03_mismatch"
      | "gate_03_expired",
    message: string,
  ) {
    super(message);
  }
}

/** Keeps delivery promises out of free text and inserts only the current human-approved Gate 03 result. */
export function buildControlledReply(input: {
  draft: string;
  context: FollowUpContext;
  rfqRef?: string;
  delivery: DeliveryConfirmation | null;
  now: Date;
}) {
  if (DELIVERY_CLAIM_PATTERN.test(input.draft))
    throw new ControlledReplyError(
      "delivery_claim_in_draft",
      "自由文本不能包含交期承诺；请选择交期场景，由系统插入有效的 Gate 03 结果。",
    );
  if (input.context !== "asks_lead_time" && input.context !== "asks_sample") return input.draft;
  if (!input.delivery)
    throw new ControlledReplyError("gate_03_missing", "该场景必须先完成 Gate 03 交期确认。");
  if (input.delivery.status !== "confirmed")
    throw new ControlledReplyError(
      "gate_03_not_confirmed",
      "Gate 03 尚未批准或已经失效，不能生成交期回复。",
    );
  const validUntil = input.delivery.result?.valid_until;
  const leadTimeDays = input.delivery.result?.confirmed_lead_time_days;
  if (
    input.delivery.related_entity_id !== input.rfqRef ||
    !validUntil ||
    !Number.isInteger(leadTimeDays)
  )
    throw new ControlledReplyError("gate_03_mismatch", "Gate 03 与当前 RFQ 不匹配，不能用于回复。");
  if (Date.parse(validUntil) <= input.now.getTime())
    throw new ControlledReplyError("gate_03_expired", "Gate 03 交期确认已过期，请重新申请确认。");
  return `${input.draft}\n\nConfirmed lead time: ${leadTimeDays} days. Valid through ${validUntil.slice(0, 10)} (Gate 03).`;
}
