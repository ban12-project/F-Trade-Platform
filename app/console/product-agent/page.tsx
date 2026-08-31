import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { getStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { requirePermission } from "@/lib/auth-guard";

import { ProductAgentPanel } from "./product-agent-panel";

export default function ProductAgentPage() {
  return <Suspense fallback={<ConsoleLoading />}><AuthorizedProductAgent /></Suspense>;
}

async function AuthorizedProductAgent() {
  await requirePermission("product:write");
  const settings = await getStoredProductAgentModelSettings();
  return <ProductAgentPanel configured={Boolean(settings?.apiKeyConfigured || settings?.authTokenConfigured)} />;
}
