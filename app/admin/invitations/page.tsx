import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";

import { InvitationPanel } from "./panel";

export default async function InvitationsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
  return <InvitationPanel />;
}
