import { Suspense } from "react";

import { requirePermission } from "@/lib/auth-guard";
import { ConsoleLoading } from "@/components/console-loading";

import { InvitationPanel } from "./panel";

async function AuthorizedInvitationPanel() {
  await requirePermission("team:manage");
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
