export function nextFollowUp(
  context:
    | "quote_sent_unread"
    | "quote_sent_read_no_reply"
    | "price_high"
    | "purchase_later"
    | "asks_sample"
    | "asks_lead_time",
) {
  const policy = {
    quote_sent_unread: ["wait_then_reference_quote_validity", false],
    quote_sent_read_no_reply: ["ask_one_decision_blocking_question", false],
    price_high: ["ask_target_budget_and_escalate", true],
    purchase_later: ["record_timing_and_request_follow_up_consent", false],
    asks_sample: ["collect_sample_requirements_and_escalate", true],
    asks_lead_time: ["request_factory_delivery_confirmation", true],
  } as const;
  const [action, human_escalation] = policy[context];
  return {
    action,
    human_escalation,
    prohibited: human_escalation ? "agent_commitment" : "repetitive_generic_follow_up",
  };
}
