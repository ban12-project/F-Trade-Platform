import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { ConsoleLoading } from "@/components/console-loading";

import { InvitationPanel } from "./panel";

async function AuthorizedInvitationPanel() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
  return <InvitationPanel />;
}

function InvitationShell() {
  return <ConsoleLoading />;
}

export default function InvitationsPage() {
  return (
    <Suspense fallback={<InvitationShell />}>
      <AuthorizedInvitationPanel />
    </Suspense>
  );
}
