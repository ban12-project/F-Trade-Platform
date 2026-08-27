import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

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
