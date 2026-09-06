"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import {
  closeFacebookInteractive,
  openFacebookInteractive,
  readFacebookAccountStatus,
  resumeFacebookAccount,
  saveFacebookCredentials,
} from "@/lib/social/facebook-account-store";

async function owner() {
  const current = await auth.api.getSession({ headers: await headers() });
  if (
    !current?.user ||
    !hasPermission(current.user.role, "settings:manage") ||
    current.user.id !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID
  )
    throw new Error("仅配置的账号拥有者可以管理此 Facebook 账号。");
  return current;
}
export async function facebookAccountStatusAction() {
  await owner();
  return readFacebookAccountStatus();
}
export async function saveFacebookCredentialsAction(input: unknown) {
  const current = await owner();
  try {
    await saveFacebookCredentials(input, current.user.id);
    return {
      ok: true,
      message: "凭据已加密保存，渠道已暂停。修改代理后需重启浏览器服务以应用配置。",
    };
  } catch {
    return { ok: false, message: "保存失败。请检查输入、数据库迁移及凭据加密密钥。" };
  }
}
export async function openFacebookInteractiveAction(input: unknown) {
  const current = await owner();
  try {
    if (process.env.SOCIAL_FACEBOOK_WORKER_ENABLED !== "1")
      return { ok: false as const, message: "Facebook Worker 尚未启用，不能创建远程连接。" };
    return {
      ok: true as const,
      connection: await openFacebookInteractive(input, current.user.id, current.session.id),
    };
  } catch {
    return {
      ok: false as const,
      message: "无法连接。请检查凭据配置，并确认没有进行中的发布或其他登录连接。",
    };
  }
}
export async function closeFacebookInteractiveAction(id: unknown) {
  const current = await owner();
  await closeFacebookInteractive(z.uuid().parse(id), current.user.id);
  return { ok: true };
}
export async function resumeFacebookAccountAction() {
  const current = await owner();
  try {
    await resumeFacebookAccount(current.user.id);
    return { ok: true, message: "渠道已恢复，Worker 将在下次轮询时重新校验登录状态。" };
  } catch {
    return {
      ok: false,
      message: "恢复失败。请先完成账号校验、关闭连接，并处理未知结果或暂停的任务。",
    };
  }
}
