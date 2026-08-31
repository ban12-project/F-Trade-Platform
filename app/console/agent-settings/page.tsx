import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { getStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { requirePermission } from "@/lib/auth-guard";

import { AgentSettingsPanel } from "./panel";

async function AuthorizedAgentSettings() {
  await requirePermission("settings:manage");
  return <AgentSettingsPanel settings={await getStoredProductAgentModelSettings()} />;
}

export default function AgentSettingsPage() {
  return <Suspense fallback={<ConsoleLoading />}><AuthorizedAgentSettings /></Suspense>;
}
