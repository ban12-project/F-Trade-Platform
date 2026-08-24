export function decideContent(content: Record<string, any>, decision: { actorType: "human" | "agent"; approved: boolean; approvalRef: string; evidenceRef: string }) {
  if (content.status !== "review_required") throw new Error("Content must be reviewed before a Gate 01 decision");
  if (decision.actorType !== "human") throw new Error("Gate 01 content decisions require a human actor");
  if (!decision.approvalRef.trim() || !decision.evidenceRef.trim()) throw new Error("Gate 01 content decisions require approval and evidence");
  return { ...content, status: decision.approved ? "approved" : "revision_required", approval_ref: decision.approvalRef };
}
export function publishContent(content: Record<string, any>, actorType: "human" | "agent" | "system", publishedRef: string) {
  if (content.status !== "approved") throw new Error("Only approved content can be published");
  if (actorType === "agent") throw new Error("An agent cannot publish content");
  if (!publishedRef.trim()) throw new Error("Published content requires a publication reference");
  return { ...content, status: "published", published_ref: publishedRef };
}
