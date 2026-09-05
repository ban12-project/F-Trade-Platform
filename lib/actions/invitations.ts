"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { invitationFormSchema } from "@/lib/form-schemas";
import { issueInvitation, provisionInvitedUser } from "@/lib/invitations";

export type InvitationActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function actionError(error: unknown, fallback: string): InvitationActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : fallback,
  };
}

export async function createInvitationAction(
  _previousState: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "team:manage")) {
    return { status: "error", message: "无权发送邀请。" };
  }

  const parsed = invitationFormSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "请输入有效的邮箱地址。",
    };
  }

  try {
    await issueInvitation({ email: parsed.data.email, invitedBy: session.user.id });
    return { status: "success", message: "邀请已发送。链接将在 7 天后过期。" };
  } catch (error) {
    return actionError(error, "无法发送邀请。");
  }
}

export async function provisionInvitedUserAction(input: {
  email: string;
  token: string;
}): Promise<InvitationActionState> {
  const parsed = invitationFormSchema.safeParse({ email: input.email });
  if (!parsed.success || typeof input.token !== "string" || input.token.length < 32) {
    return { status: "error", message: "邀请无效。" };
  }

  try {
    await provisionInvitedUser({ email: parsed.data.email, token: input.token });
    return { status: "success", message: "邀请已确认，请发送邮箱验证码。" };
  } catch (error) {
    return actionError(error, "无法激活邀请。");
  }
}
