"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { listBrowserNodes, ownerBrowserCommand } from "@/lib/browser-fleet/store";

async function actor() {
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current?.user || !hasPermission(current.user.role, "settings:manage")) throw new Error("需要节点管理权限。");
  return { id: current.user.id, sessionId: current.session.id };
}
export async function browserNodesAction() {
  return listBrowserNodes((await actor()).id);
}
export async function browserNodeCommandAction(input: unknown) {
  const current = await actor();
  try {
    return { ok: true as const, result: await ownerBrowserCommand(input, current) };
  } catch {
    return { ok: false as const, message: "操作未完成。请检查节点归属、代理配置、数据库迁移及运行中的任务；账号不可同时绑定多个节点。" };
  }
}
