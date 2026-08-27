import { Suspense } from "react";

import { requireAdmin } from "@/lib/auth-guard";
import { ConsoleLoading } from "@/components/console-loading";

import { InvitationPanel } from "./panel";

async function AuthorizedInvitationPanel() {
  await requireAdmin();
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
