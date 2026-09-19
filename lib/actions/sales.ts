"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { rfqFormSchema, rfqReadyFormSchema } from "@/lib/form-schemas";
import { rfqMissingLabel } from "@/lib/sales/journey";
import { createRfq, reviseRfq, submitRfqReady } from "@/lib/sales/store";
import { assertWorkspaceAggregateLink, assertWorkspaceProjectKind } from "@/lib/workspace/store";

export type SalesActionState = {
  status: "idle" | "success" | "error";
  message: string;
  rfqId?: string;
};
function projectIdFrom(formData: FormData) {
  const value = formData.get("projectId");
  if (value === null || value === "") return undefined;
  return z.uuid("项目标识无效。").parse(value);
}

/** Untrusted UI boundary for intake only. It cannot create a quotation. */
export async function createRfqAction(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "sales:write"))
    return { status: "error", message: "无权录入询盘。" };
  const parsed = rfqFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { status: "error", message: parsed.error.issues[0]?.message ?? "询盘资料格式不正确。" };
  try {
    const projectId = projectIdFrom(formData);
    if (projectId) await assertWorkspaceProjectKind(projectId, "sales", session.user.id);
    const result = await createRfq(parsed.data, session.user.id, projectId);
    revalidatePath("/workspace", "layout");
    if (projectId) revalidatePath(`/workspace/${projectId}`);
    return {
      status: "success",
      message: result.draft.missing_fields.length
        ? `询盘已保存，还需补充：${result.draft.missing_fields.map(rfqMissingLabel).join("、")}。`
        : "询盘已保存，可提交人工报价交接。",
      rfqId: result.id,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法保存询盘。" };
  }
}

export async function submitRfqReadyAction(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "sales:write"))
    return { status: "error", message: "无权确认客户需求。" };
  const parsed = rfqReadyFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { status: "error", message: parsed.error.issues[0]?.message ?? "询盘或确认凭据无效。" };
  const { rfqId, evidenceRef } = parsed.data;
  try {
    const projectId = projectIdFrom(formData);
    if (projectId)
      await assertWorkspaceAggregateLink(projectId, rfqId, "sales", "rfq", session.user.id);
    const result = await submitRfqReady(rfqId, evidenceRef, session.user.id, projectId);
    revalidatePath("/workspace", "layout");
    if (projectId) revalidatePath(`/workspace/${projectId}`);
    return result.state === "RFQ_READY"
      ? { status: "success", message: "需求已确认完整，可以创建人工报价。", rfqId }
      : {
          status: "error",
          message: `需求仍缺少：${result.missingFields.map(rfqMissingLabel).join("、")}。`,
        };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法确认客户需求。",
    };
  }
}

export async function reviseRfqAction(
  _previous: SalesActionState,
  formData: FormData,
): Promise<SalesActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "sales:write"))
    return { status: "error", message: "无权补充询盘。" };
  const rfqId = formData.get("rfqId");
  if (typeof rfqId !== "string" || !z.uuid().safeParse(rfqId).success)
    return { status: "error", message: "RFQ 标识无效。" };
  const parsed = rfqFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { status: "error", message: parsed.error.issues[0]?.message ?? "询盘资料格式不正确。" };
  try {
    const projectId = projectIdFrom(formData);
    if (projectId)
      await assertWorkspaceAggregateLink(projectId, rfqId, "sales", "rfq", session.user.id);
    const result = await reviseRfq(rfqId, parsed.data, session.user.id, projectId);
    revalidatePath("/workspace", "layout");
    if (projectId) revalidatePath(`/workspace/${projectId}`);
    return {
      status: "success",
      message: result.draft.missing_fields.length
        ? `询盘已更新，还需补充：${result.draft.missing_fields.map(rfqMissingLabel).join("、")}。`
        : "询盘信息已完整，可以提交报价交接。",
      rfqId,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法更新询盘。" };
  }
}
