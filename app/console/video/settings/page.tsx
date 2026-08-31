import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { requirePermission } from "@/lib/auth-guard";
import { listVideoProviderSettings } from "@/lib/video/provider-config-store";

import { VideoProviderSettingsPanel } from "./panel";

async function AuthorizedVideoProviderSettings() {
  await requirePermission("settings:manage");
  return <VideoProviderSettingsPanel settings={await listVideoProviderSettings()} />;
}

export default function VideoProviderSettingsPage() {
  return <Suspense fallback={<ConsoleLoading />}><AuthorizedVideoProviderSettings /></Suspense>;
}
