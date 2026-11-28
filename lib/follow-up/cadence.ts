const cadence = {
  quote_sent_unread: {
    label: "报价未读",
    action: "wait_then_reference_quote_validity",
    human_escalation: false,
  },
  quote_sent_read_no_reply: {
    label: "已读未回复",
    action: "ask_one_decision_blocking_question",
    human_escalation: false,
  },
  price_high: {
    label: "反馈价格高",
    action: "ask_target_budget_and_escalate",
    human_escalation: true,
  },
  purchase_later: {
    label: "稍后采购",
    action: "record_timing_and_request_follow_up_consent",
    human_escalation: false,
  },
  asks_sample: {
    label: "询问样品",
    action: "collect_sample_requirements_and_escalate",
    human_escalation: true,
  },
  asks_lead_time: {
    label: "询问交期",
    action: "request_factory_delivery_confirmation",
    human_escalation: true,
  },
} as const;

export type FollowUpContext = keyof typeof cadence;
export const followUpContexts = Object.keys(cadence) as FollowUpContext[];

export function followUpContextLabel(context: FollowUpContext) {
  return cadence[context].label;
}

export function needsDeliveryConfirmation(context: FollowUpContext | undefined) {
  return context === "asks_lead_time" || context === "asks_sample";
}

export function nextFollowUp(context: FollowUpContext) {
  const { action, human_escalation } = cadence[context];
  return {
    action,
    human_escalation,
    prohibited: human_escalation ? "agent_commitment" : "repetitive_generic_follow_up",
  };
}
