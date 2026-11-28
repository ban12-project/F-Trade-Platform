// MVP scoring policy v1 (proposed). Changing weights or bands requires product review.
export const scoringRules = [
  { id: "active_inquiry", label: "主动询盘", points: 20 },
  { id: "provides_oe_number", label: "提供 OE", points: 15 },
  { id: "explicit_quantity", label: "明确数量", points: 15 },
  { id: "target_quantity_range", label: "目标数量区间", points: 10 },
  { id: "asks_sample", label: "询问样品", points: 10 },
  { id: "asks_lead_time", label: "询问交期", points: 10 },
  { id: "asks_payment_terms", label: "询问付款条件", points: 15 },
  { id: "replies_again", label: "再次回复", points: 15 },
] as const;

const firstWarmScore = 31;
export const firstHotScore = 61;

export function scoreLead(triggered: string[]) {
  const evidence = [...new Set(triggered)].flatMap((id) => {
    const rule = scoringRules.find((rule) => rule.id === id);
    return rule ? [{ rule_id: rule.id, points: rule.points }] : [];
  });
  const raw_score = evidence.reduce((sum, item) => sum + item.points, 0);
  const score = Math.min(100, raw_score);
  const status = score >= firstHotScore ? "HOT" : score >= firstWarmScore ? "WARM" : "COLD";
  return { raw_score, score, status, evidence } as const;
}
