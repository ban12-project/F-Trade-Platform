import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/authz";

/**
 * Performs the database-backed role check required before protected pages load
 * data. Proxy only performs the faster cookie check.
 */
export async function requireRole(...allowedRoles: readonly string[]) {
  if (allowedRoles.length === 0) {
    throw new Error("requireRole needs at least one allowed role");
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  if (!session.user.role || !allowedRoles.includes(session.user.role)) redirect("/auth?error=access-denied");
  return session;
}

/**
 * Page-level authorization. Server Actions must perform the same check again.
 */
export async function requirePermission(permission: Permission) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  if (!hasPermission(session.user.role, permission)) redirect("/auth?error=access-denied");
  return session;
}
