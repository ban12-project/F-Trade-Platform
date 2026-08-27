import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

/**
 * Performs the database-backed authorization check required before console
 * pages load protected data. Proxy only performs the faster cookie check.
 */
export async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  if (session.user.role !== "admin") redirect("/auth?error=access-denied");
  return session;
}
