import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { requirePermission } from "@/lib/auth-guard";

import { PasskeyPanel } from "./passkey-panel";

async function AuthorizedPasskeySettings() {
  await requirePermission("workspace:view");
  return <PasskeyPanel />;
}

export default function SecurityPage() {
  return (
    <Suspense fallback={<ConsoleLoading />}>
      <AuthorizedPasskeySettings />
    </Suspense>
  );
}
