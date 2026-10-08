"use server";

import { after } from "next/server";
import {
  actionError,
  authorizedActionSession,
  refreshWorkspace,
  requireActionActor,
} from "@/lib/action-boundary";
import type { ClosingActionState } from "@/lib/action-states";
import {
  deliveryDecisionFormSchema,
  deliveryRequestFormSchema,
  followUpFormSchema,
  inboundRoutingFormSchema,
  opportunityDecisionFormSchema,
  publicationConfirmationFormSchema,
  quotationDecisionFormSchema,
  quotationDraftFormSchema,
  quotationSendFormSchema,
} from "@/lib/form-schemas";
import {
  confirmOpportunity,
  createDeliveryRequest,
  createOrReviseQuotation,
  decideDelivery,
  decideQuotation,
  recordFollowUp,
  sendQuotation,
} from "@/lib/sales/closing-store";
import { SocialHumanAccessError, socialHumanFailureMessage } from "@/lib/social/human-write-access";
import { routeInboundConversation } from "@/lib/social/inbound-routing-store";
import { submitControlledPublication } from "@/lib/social/publication-store";

const actor = requireActionActor;
const resultError = actionError;
const refresh = refreshWorkspace;
function values(formData: FormData) {
  return Object.fromEntries(formData);
}

export async function saveQuotationAction(
  _previous: ClosingActionState,
  formData: FormData,
): Promise<ClosingActionState> {
  try {
    const actorId = await actor("sales:write");
    const parsed = quotationDraftFormSchema.safeParse(values(formData));
    if (!parsed.success) return resultError(parsed.error);
    const saved = await createOrReviseQuotation(parsed.data, actorId);
    refresh(parsed.data.projectId);
    return { status: "success", message: "报价已保存并提交人工审核。", id: saved.id };
  } catch (error) {
    return resultError(error);
  }
}
export async function decideQuotationAction(
  _previous: ClosingActionState,
  formData: FormData,
): Promise<ClosingActionState> {
  try {
    const actorId = await actor("quotation:review");
    const parsed = quotationDecisionFormSchema.safeParse(values(formData));
    if (!parsed.success) return resultError(parsed.error);
    const saved = await decideQuotation(parsed.data, actorId);
    refresh(parsed.data.projectId);
    return {
      status: "success",
      message: parsed.data.decision === "approved" ? "人工报价已批准。" : "报价已退回修订。",
      id: saved.id,
    };
  } catch (error) {
    return resultError(error);
  }
}
export async function sendQuotationAction(
  _previous: ClosingActionState,
  formData: FormData,
): Promise<ClosingActionState> {
  try {
    const actorId = await actor("sales:write");
    const parsed = quotationSendFormSchema.safeParse(values(formData));
    if (!parsed.success) return resultError(parsed.error);
    const saved = await sendQuotation(parsed.data, actorId);
    refresh(parsed.data.projectId);
    return {
      status: "success",
      message: "发送凭证已登记，报价进入已发送，可继续客户跟进。",
      id: saved.leadId,
    };
  } catch (error) {
    return resultError(error);
  }
}
export async function recordFollowUpAction(
  _previous: ClosingActionState,
  formData: FormData,
): Promise<ClosingActionState> {
  try {
    const current = await authorizedActionSession("sales:write");
    if (!current) throw new SocialHumanAccessError();
    const parsed = followUpFormSchema.safeParse({
      ...values(formData),
      triggeredRules: formData.getAll("triggeredRules"),
    });
    if (!parsed.success)
      return { status: "error", message: parsed.error.issues[0]?.message ?? "请检查回复信息。" };
    await recordFollowUp(parsed.data, {
      actorId: current.user.id,
      sessionId: current.session.id,
      projectId: parsed.data.projectId,
    });
    try {
      refresh(parsed.data.projectId);
    } catch {
      /* Preserve the committed reply submission. */
    }
    return {
      status: "success",
      message: "人工确认的回复已安全提交；发送前已重新校验项目权限、渠道状态和回复窗口。",
      id: parsed.data.leadId,
    };
  } catch (error) {
    return {
      status: "error",
      message: socialHumanFailureMessage(
        error,
        "回复未提交。请刷新并核对登录、项目权限、渠道和回复窗口后重试。",
      ),
    };
  }
}
export async function requestDeliveryAction(
  _previous: ClosingActionState,
  formData: FormData,
): Promise<ClosingActionState> {
  try {
    const actorId = await actor("sales:write");
    const parsed = deliveryRequestFormSchema.safeParse(values(formData));
    if (!parsed.success) return resultError(parsed.error);
    const saved = await createDeliveryRequest(parsed.data, actorId);
    refresh(parsed.data.projectId);
    return { status: "success", message: "已提交工厂交期确认请求。", id: saved.id };
  } catch (error) {
    return resultError(error);
  }
}
export async function decideDeliveryAction(
  _previous: ClosingActionState,
  formData: FormData,
): Promise<ClosingActionState> {
  try {
    const actorId = await actor("delivery:review");
    const parsed = deliveryDecisionFormSchema.safeParse(values(formData));
    if (!parsed.success) return resultError(parsed.error);
    const saved = await decideDelivery(parsed.data, actorId);
    refresh(parsed.data.projectId);
    return {
      status: "success",
      message: parsed.data.decision === "confirmed" ? "工厂交期已确认。" : "交期确认已拒绝。",
      id: saved.id,
    };
  } catch (error) {
    return resultError(error);
  }
}
export async function confirmOpportunityAction(
  _previous: ClosingActionState,
  formData: FormData,
): Promise<ClosingActionState> {
  try {
    const actorId = await actor("sales:write");
    const parsed = opportunityDecisionFormSchema.safeParse(values(formData));
    if (!parsed.success) return resultError(parsed.error);
    await confirmOpportunity(parsed.data, actorId);
    refresh(parsed.data.projectId);
    return { status: "success", message: "已由人工确认有效商机。", id: parsed.data.leadId };
  } catch (error) {
    return resultError(error);
  }
}
export async function confirmPublicationAction(
  _previous: ClosingActionState,
  formData: FormData,
): Promise<ClosingActionState> {
  try {
    const current = await authorizedActionSession("content:write");
    if (!current) throw new SocialHumanAccessError();
    const parsed = publicationConfirmationFormSchema.safeParse(values(formData));
    if (!parsed.success) return resultError(parsed.error);
    const saved = await submitControlledPublication(parsed.data, {
      actorId: current.user.id,
      sessionId: current.session.id,
      projectId: parsed.data.projectId,
    });
    try {
      after(async () => {
        try {
          const { deliverPublicationSandbox } = await import(
            "@/lib/browser-fleet/sandbox-workflow-delivery"
          );
          await deliverPublicationSandbox(saved.id);
        } catch {
          // Publication demand is durable; the dispatch cron recovers it.
        }
      });
    } catch {
      /* The committed job is recovered by authenticated dispatch. */
    }
    try {
      refresh(parsed.data.projectId);
    } catch {
      /* Preserve the committed result if cache refresh fails. */
    }
    return {
      status: "success",
      message: "发布任务已提交；只有平台成功回执才能标记为已发布，未知结果不会自动重试。",
      id: saved.id,
    };
  } catch (error) {
    return {
      status: "error",
      message: socialHumanFailureMessage(
        error,
        "发布未提交。请刷新并核对内容、项目权限和渠道状态后重试。",
      ),
    };
  }
}

export async function routeInboundConversationAction(
  _previous: ClosingActionState,
  formData: FormData,
): Promise<ClosingActionState> {
  try {
    const current = await authorizedActionSession("sales:write");
    if (!current) throw new SocialHumanAccessError();
    const parsed = inboundRoutingFormSchema.safeParse(values(formData));
    if (!parsed.success)
      return { status: "error", message: parsed.error.issues[0]?.message ?? "请检查分流信息。" };
    const saved = await routeInboundConversation(parsed.data, {
      actorId: current.user.id,
      sessionId: current.session.id,
    });
    try {
      refresh(saved.projectId);
    } catch {
      /* Preserve the committed routing result. */
    }
    return {
      status: "success",
      message:
        parsed.data.mode === "create"
          ? "已创建去标识化销售项目并接入线索。"
          : "入站消息已关联到销售项目。",
      id: saved.leadId,
      projectId: saved.projectId,
    };
  } catch (error) {
    return {
      status: "error",
      message: socialHumanFailureMessage(
        error,
        "入站消息未分流。请刷新并核对登录、消息状态和销售项目权限后重试。",
      ),
    };
  }
}
