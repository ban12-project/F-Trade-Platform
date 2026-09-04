const points: Record<string, number> = {
  active_inquiry: 20,
  provides_oe_number: 15,
  explicit_quantity: 15,
  target_quantity_range: 10,
  asks_sample: 10,
  asks_lead_time: 10,
  asks_payment_terms: 15,
  replies_again: 15,
};
export function scoreLead(triggered: string[]) {
  const evidence = [...new Set(triggered)]
    .filter((id) => id in points)
    .map((id) => ({ rule_id: id, points: points[id] }));
  const raw_score = evidence.reduce((sum, item) => sum + item.points, 0);
  const score = Math.min(100, raw_score);
  return {
    raw_score,
    score,
    status: score <= 30 ? "COLD" : score <= 60 ? "WARM" : "HOT",
    evidence,
  };
}
