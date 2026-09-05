"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { socialControlChangeSchema } from "@/lib/social/control-record";
import { saveSocialChannelControl } from "@/lib/social/control-store";

export type SocialControlActionState = { status: "idle" | "success" | "error"; message: string };
/** Server-side authorization, validation and minimal return boundary for social channel operations. */
export async function saveSocialChannelControlAction(
  _previous: SocialControlActionState,
  formData: FormData,
): Promise<SocialControlActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin")
    return { status: "error", message: "无权修改社交渠道控制状态。" };
  const parsed = socialControlChangeSchema.safeParse({
    channelRef: formData.get("channelRef"),
    accountRef: formData.get("accountRef"),
    action: formData.get("action"),
    actorType: "human",
    actorId: session.user.id,
    evidenceRef: formData.get("evidenceRef"),
  });
  if (!parsed.success)
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "社交渠道控制输入无效。",
    };
  try {
    const result = await saveSocialChannelControl(parsed.data);
    revalidatePath("/workspace", "layout");
    return {
      status: "success",
      message: `渠道已${result.circuitStatus === "active" ? "启用" : "暂停"}；操作已写入审计记录。`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "无法保存社交渠道控制状态。",
    };
  }
}
