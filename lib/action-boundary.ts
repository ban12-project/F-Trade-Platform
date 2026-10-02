import "server-only";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/authz";

// Every Action calls this independently; rendering and Proxy checks are not authorization boundaries.
export async function authorizedActionSession(permission: Permission) {
  const session = await auth.api.getSession({ headers: await headers() });
  return session && hasPermission(session.user.role, permission) ? session : null;
}
export async function requireActionActor(permission: Permission, message = "无权执行该操作。") {
  const session = await authorizedActionSession(permission);
  if (!session) throw new Error(message);
  return session.user.id;
}
export function actionError(
  error: unknown,
  fallback = "操作未完成，请重试。",
): { status: "error"; message: string } {
  return {
    status: "error",
    message:
      error instanceof ZodError
        ? (error.issues[0]?.message ?? "请检查表单内容。")
        : error instanceof Error
          ? error.message
          : fallback,
  };
}
export function refreshWorkspace(projectId?: string) {
  revalidatePath("/workspace", "layout");
  if (projectId) revalidatePath(`/workspace/${projectId}`);
}
