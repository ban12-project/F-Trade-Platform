import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { requireRole } from "@/lib/auth-guard";

import { SocialControlPanel } from "./social-control-panel";

async function AuthorizedSocialControls() {
  await requireRole("admin");
  return <SocialControlPanel />;
}

export default function SocialControlsPage() {
  return <Suspense fallback={<ConsoleLoading />}><AuthorizedSocialControls /></Suspense>;
}
