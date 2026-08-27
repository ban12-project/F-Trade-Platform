import { Suspense } from "react";

import { requireRole } from "@/lib/auth-guard";
import { ConsoleLoading } from "@/components/console-loading";

import { InvitationPanel } from "./panel";

async function AuthorizedInvitationPanel() {
  await requireRole("admin");
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
