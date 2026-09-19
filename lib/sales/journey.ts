/** Inputs must already be restricted to one authorized project. This is a read model only. */
export type SalesRelationRecord = {
  id: string;
  kind: "rfq" | "quotation" | "lead" | "delivery";
  state: string;
  title: string;
  rfqId?: string;
  leadId?: string;
  quotationId?: string;
  deliveryId?: string;
};

export type SalesRelations = {
  current: SalesRelationRecord;
  related: SalesRelationRecord[];
  missingContext: boolean;
};

export function salesRelations(
  records: SalesRelationRecord[],
  kind: SalesRelationRecord["kind"],
  id: string,
): SalesRelations | null {
  const current = records.find((record) => record.kind === kind && record.id === id);
  if (!current) return null;
  const rfqs = records.filter((record) => record.kind === "rfq");
  const leads = records.filter((record) => record.kind === "lead");
  const quotations = records.filter((record) => record.kind === "quotation");
  const deliveries = records.filter((record) => record.kind === "delivery");
  const rfqMatchesLead = (rfq: SalesRelationRecord, lead: SalesRelationRecord) =>
    rfq.leadId ? rfq.leadId === lead.id : lead.rfqId === rfq.id;

  const selectedRfqs =
    kind === "rfq"
      ? [current]
      : kind === "lead"
        ? rfqs.filter((rfq) => rfqMatchesLead(rfq, current))
        : rfqs.filter((rfq) => rfq.id === current.rfqId);
  const rfqIds = new Set(selectedRfqs.map((rfq) => rfq.id));
  const selectedLeads =
    kind === "lead"
      ? [current]
      : leads.filter((lead) => selectedRfqs.some((rfq) => rfqMatchesLead(rfq, lead)));
  const selectedQuotes = quotations.filter(
    (quote) => rfqIds.has(quote.rfqId ?? "") || (kind === "quotation" && quote.id === id),
  );
  const selectedDeliveries = deliveries.filter(
    (delivery) => rfqIds.has(delivery.rfqId ?? "") || (kind === "delivery" && delivery.id === id),
  );
  const missingContext =
    (kind !== "rfq" && kind !== "lead" && selectedRfqs.length === 0) ||
    (kind === "rfq" && Boolean(current.leadId) && selectedLeads.length === 0) ||
    (kind === "lead" &&
      ((Boolean(current.rfqId) && !rfqIds.has(current.rfqId!)) ||
        (Boolean(current.quotationId) &&
          !selectedQuotes.some((quote) => quote.id === current.quotationId)) ||
        (Boolean(current.deliveryId) &&
          !selectedDeliveries.some((delivery) => delivery.id === current.deliveryId))));

  return {
    current,
    related: [...selectedLeads, ...selectedRfqs, ...selectedQuotes, ...selectedDeliveries].filter(
      (record) => record.kind !== kind || record.id !== id,
    ),
    missingContext,
  };
}

export const salesStateLabels: Record<string, string> = {
  LEAD_RECEIVED: "待整理客户需求",
  RFQ_COLLECTING: "需求待补充",
  RFQ_READY: "需求已确认",
  QUOTE_REVIEW_REQUIRED: "等待报价审核",
  QUOTE_REVISION_REQUIRED: "报价待修订",
  QUOTE_APPROVED: "报价已批准，待登记发送",
  QUOTE_SENT: "报价已登记发送",
  FOLLOW_UP: "持续跟进",
  OPPORTUNITY: "已确认有效商机",
  DELIVERY_CONFIRMATION_PENDING: "等待工厂交期确认",
  DELIVERY_CONFIRMATION_CONFIRMED: "交期已确认",
  DELIVERY_CONFIRMATION_REJECTED: "交期确认未通过",
};

export const salesNextActionLabels: Record<string, string> = {
  collect_rfq_facts: "整理客户需求，补齐产品、数量和目的地",
  collect_rfq: "整理客户需求，补齐产品、数量和目的地",
  ask_one_specific_question: "提出一个需要客户补充的具体问题",
  wait_then_reference_quote_validity: "等待客户查看，适时提醒报价有效期",
  ask_one_decision_blocking_question: "询问当前影响采购决定的问题",
  ask_target_budget_and_escalate: "了解目标预算，交由人工销售评估",
  record_timing_and_request_follow_up_consent: "记录采购时间，并征得后续联系同意",
  collect_sample_requirements_and_escalate: "收集样品需求，交由人工确认",
  request_factory_delivery_confirmation: "向工厂申请交期确认",
};

export function rfqMissingLabel(field: string) {
  return (
    (
      {
        product_type: "产品类型",
        vehicle_model_or_oe_number: "OE 编号或完整车型",
        quantity: "数量",
        destination: "目的地",
      } as Record<string, string>
    )[field] ?? "待补充资料"
  );
}
export function productTypeLabel(type: string) {
  return (
    (
      {
        clutch_disc: "离合器片",
        clutch_cover: "离合器盖 / 压盘",
        release_bearing: "分离轴承",
        clutch_kit: "离合器套件",
      } as Record<string, string>
    )[type] ?? "产品"
  );
}
