"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";

import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/authz";
import { deliveryDecisionFormSchema, deliveryRequestFormSchema, followUpFormSchema, inboundRoutingFormSchema, opportunityDecisionFormSchema, publicationConfirmationFormSchema, quotationDecisionFormSchema, quotationDraftFormSchema, quotationSendFormSchema } from "@/lib/form-schemas";
import { confirmExternalPublication } from "@/lib/social/publication-store";
import { routeInboundConversation } from "@/lib/social/inbound-routing-store";
import { confirmOpportunity, createDeliveryRequest, createOrReviseQuotation, decideDelivery, decideQuotation, recordFollowUp, sendQuotation } from "@/lib/sales/closing-store";

export type ClosingActionState = { status: "idle" | "success" | "error"; message: string; id?: string; projectId?: string };
export const initialClosingActionState: ClosingActionState = { status: "idle", message: "" };

async function actor(permission: Permission) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, permission)) throw new Error("无权执行该操作。");
  return session.user.id;
}
function values(formData: FormData) { return Object.fromEntries(formData); }
function resultError(error: unknown): ClosingActionState {
  if (error instanceof ZodError) return { status: "error", message: error.issues[0]?.message ?? "请检查表单内容。" };
  return { status: "error", message: error instanceof Error ? error.message : "操作未完成，请重试。" };
}
function refresh(projectId: string) { revalidatePath("/workspace"); revalidatePath(`/workspace/${projectId}`); }

export async function saveQuotationAction(_previous: ClosingActionState, formData: FormData): Promise<ClosingActionState> {
  try { const actorId = await actor("sales:write"); const parsed = quotationDraftFormSchema.safeParse(values(formData)); if (!parsed.success) return resultError(parsed.error); const saved = await createOrReviseQuotation(parsed.data, actorId); refresh(parsed.data.projectId); return { status: "success", message: "报价已保存并提交 Gate 02。", id: saved.id }; } catch (error) { return resultError(error); }
}
export async function decideQuotationAction(_previous: ClosingActionState, formData: FormData): Promise<ClosingActionState> {
  try { const actorId = await actor("quotation:review"); const parsed = quotationDecisionFormSchema.safeParse(values(formData)); if (!parsed.success) return resultError(parsed.error); const saved = await decideQuotation(parsed.data, actorId); refresh(parsed.data.projectId); return { status: "success", message: parsed.data.decision === "approved" ? "Gate 02 已批准报价。" : "报价已退回修订。", id: saved.id }; } catch (error) { return resultError(error); }
}
export async function sendQuotationAction(_previous: ClosingActionState, formData: FormData): Promise<ClosingActionState> {
  try { const actorId = await actor("sales:write"); const parsed = quotationSendFormSchema.safeParse(values(formData)); if (!parsed.success) return resultError(parsed.error); const saved = await sendQuotation(parsed.data, actorId); refresh(parsed.data.projectId); return { status: "success", message: "外部发送凭证已核验，报价进入已发送并创建跟进线索。", id: saved.leadId }; } catch (error) { return resultError(error); }
}
export async function recordFollowUpAction(_previous: ClosingActionState, formData: FormData): Promise<ClosingActionState> {
  try { const actorId = await actor("sales:write"); const parsed = followUpFormSchema.safeParse({ ...values(formData), triggeredRules: formData.getAll("triggeredRules") }); if (!parsed.success) return resultError(parsed.error); await recordFollowUp(parsed.data, actorId); refresh(parsed.data.projectId); return { status: "success", message: "跟进凭证和评分已记录；消息正文未写入明文业务聚合。", id: parsed.data.leadId }; } catch (error) { return resultError(error); }
}
export async function requestDeliveryAction(_previous: ClosingActionState, formData: FormData): Promise<ClosingActionState> {
  try { const actorId = await actor("sales:write"); const parsed = deliveryRequestFormSchema.safeParse(values(formData)); if (!parsed.success) return resultError(parsed.error); const saved = await createDeliveryRequest(parsed.data, actorId); refresh(parsed.data.projectId); return { status: "success", message: "已创建 Gate 03 交期确认请求。", id: saved.id }; } catch (error) { return resultError(error); }
}
export async function decideDeliveryAction(_previous: ClosingActionState, formData: FormData): Promise<ClosingActionState> {
  try { const actorId = await actor("delivery:review"); const parsed = deliveryDecisionFormSchema.safeParse(values(formData)); if (!parsed.success) return resultError(parsed.error); const saved = await decideDelivery(parsed.data, actorId); refresh(parsed.data.projectId); return { status: "success", message: parsed.data.decision === "confirmed" ? "Gate 03 已确认交期。" : "交期确认已拒绝。", id: saved.id }; } catch (error) { return resultError(error); }
}
export async function confirmOpportunityAction(_previous: ClosingActionState, formData: FormData): Promise<ClosingActionState> {
  try { const actorId = await actor("sales:write"); const parsed = opportunityDecisionFormSchema.safeParse(values(formData)); if (!parsed.success) return resultError(parsed.error); await confirmOpportunity(parsed.data, actorId); refresh(parsed.data.projectId); return { status: "success", message: "已由人工确认有效商机。", id: parsed.data.leadId }; } catch (error) { return resultError(error); }
}
export async function confirmPublicationAction(_previous: ClosingActionState, formData: FormData): Promise<ClosingActionState> {
  try { const actorId = await actor("content:write"); const parsed = publicationConfirmationFormSchema.safeParse(values(formData)); if (!parsed.success) return resultError(parsed.error); const saved = await confirmExternalPublication(parsed.data, actorId); refresh(parsed.data.projectId); return { status: "success", message: "平台发布凭证已登记；该记录可审计且不会自动重试。", id: saved.id }; } catch (error) { return resultError(error); }
}

export async function routeInboundConversationAction(_previous: ClosingActionState, formData: FormData): Promise<ClosingActionState> {
  try {
    const actorId = await actor("sales:write");
    const parsed = inboundRoutingFormSchema.safeParse(values(formData));
    if (!parsed.success) return resultError(parsed.error);
    const saved = await routeInboundConversation(parsed.data, actorId);
    refresh(saved.projectId);
    return { status: "success", message: parsed.data.mode === "create" ? "已创建去标识化销售项目并接入线索。" : "入站消息已关联到销售项目。", id: saved.leadId, projectId: saved.projectId };
  } catch (error) { return resultError(error); }
}
