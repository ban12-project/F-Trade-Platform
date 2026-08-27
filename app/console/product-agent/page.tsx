import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { requireRole } from "@/lib/auth-guard";
import { getStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";

import { ProductAgentPanel } from "./product-agent-panel";

async function AuthorizedProductAgent() {
  await requireRole("admin");
  const settings = await getStoredProductAgentModelSettings();
  return <ProductAgentPanel configured={Boolean(settings?.apiKeyConfigured || settings?.authTokenConfigured)} />;
}

export default function ProductAgentPage() {
  return <Suspense fallback={<ConsoleLoading />}><AuthorizedProductAgent /></Suspense>;
}
