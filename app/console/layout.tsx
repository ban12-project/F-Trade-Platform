import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { ConsoleShell } from "@/components/console-shell";
import { requirePermission } from "@/lib/auth-guard";

async function AuthorizedConsoleShell({ children }: { children: React.ReactNode }) {
  const session = await requirePermission("workspace:view");
  return <ConsoleShell role={session.user.role}>{children}</ConsoleShell>;
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<ConsoleLoading />}><AuthorizedConsoleShell>{children}</AuthorizedConsoleShell></Suspense>;
}
