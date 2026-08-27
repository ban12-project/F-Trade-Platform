"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { rfqFormSchema } from "@/lib/form-schemas";
import { createRfq, submitRfqReady } from "@/lib/sales/store";

export type SalesActionState = { status: "idle" | "success" | "error"; message: string; rfqId?: string };
export const initialSalesActionState: SalesActionState = { status: "idle", message: "" };

/** Untrusted UI boundary for intake only. It cannot create a quotation. */
export async function createRfqAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return { status: "error", message: "无权录入询盘。" };
  const parsed = rfqFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "询盘资料格式不正确。" };
  try {
    const result = await createRfq(parsed.data, session.user.id);
    revalidatePath("/console/sales");
    return { status: "success", message: result.draft.missing_fields.length ? `询盘已保存，还需补充：${result.draft.missing_fields.join("、")}。` : "询盘已保存，可提交人工报价交接。", rfqId: result.id };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法保存询盘。" };
  }
}

export async function submitRfqReadyAction(_previous: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return { status: "error", message: "无权提交 RFQ。" };
  const rfqId = formData.get("rfqId"); const evidenceRef = formData.get("evidenceRef");
  if (typeof rfqId !== "string" || typeof evidenceRef !== "string" || !/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i.test(evidenceRef)) return { status: "error", message: "RFQ 或证据引用无效。" };
  try { const result = await submitRfqReady(rfqId, evidenceRef, session.user.id); revalidatePath("/console/sales"); return result.state === "RFQ_READY" ? { status: "success", message: "RFQ 已 Ready，可由人工创建报价草稿。", rfqId } : { status: "error", message: `RFQ 仍缺少：${result.missingFields.join("、")}。` }; } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法提交 RFQ。" }; }
}
