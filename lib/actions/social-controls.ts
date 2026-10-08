"use server";

import { headers } from "next/headers";
import { refreshWorkspace } from "@/lib/action-boundary";

import { auth } from "@/lib/auth";
import { socialControlChangeSchema } from "@/lib/social/control-record";
import { saveSocialChannelControl } from "@/lib/social/control-store";
import { socialHumanFailureMessage } from "@/lib/social/human-write-access";

export type SocialControlActionState = { status: "idle" | "success" | "error"; message: string };
/** Server-side authorization, validation and minimal return boundary for social channel operations. */
export async function saveSocialChannelControlAction(
  _previous: SocialControlActionState,
  formData: FormData,
): Promise<SocialControlActionState> {
  try {
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
    const result = await saveSocialChannelControl(parsed.data, {
      actorId: session.user.id,
      sessionId: session.session.id,
    });
    try {
      refreshWorkspace();
    } catch {
      /* The control decision has already committed. */
    }
    return {
      status: "success",
      message: `渠道已${result.circuitStatus === "active" ? "启用" : "暂停"}；操作已写入审计记录。`,
    };
  } catch (error) {
    return {
      status: "error",
      message: socialHumanFailureMessage(
        error,
        "无法保存社交渠道控制状态。请刷新并确认登录与管理权限后重试。",
      ),
    };
  }
}
