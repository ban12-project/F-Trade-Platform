import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { InvitationPanel } from "./panel";

async function AuthorizedInvitationPanel() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
  return <InvitationPanel />;
}

function InvitationShell() {
  return <main className="mx-auto flex min-h-svh w-full max-w-md p-6" aria-busy="true" />;
}

export default function InvitationsPage() {
  return (
    <Suspense fallback={<InvitationShell />}>
      <AuthorizedInvitationPanel />
    </Suspense>
  );
}
