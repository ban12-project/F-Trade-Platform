import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { requireRole } from "@/lib/auth-guard";

import { PasskeyPanel } from "./passkey-panel";

async function AuthorizedPasskeySettings() {
  await requireRole("admin");
  return <PasskeyPanel />;
}

export default function SecurityPage() {
  return (
    <Suspense fallback={<ConsoleLoading />}>
      <AuthorizedPasskeySettings />
    </Suspense>
  );
}
