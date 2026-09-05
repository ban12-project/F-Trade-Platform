import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceSettingsPanel } from "@/components/workspace/workspace-settings-panel";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";

// Synthetic UI data only. This fixture never reads saved settings or credentials.
const syntheticSettings: ProductAgentModelSettings[] = [
  {
    id: "00000000-0000-4000-8000-000000000501",
    name: "日常产品导入",
    isDefault: true,
    provider: "openai",
    model: "gpt-5-mini",
    discoveredModels: ["gpt-5-mini", "synthetic-openai-model"],
    baseUrl: "https://openai.synthetic.invalid/v1",
    headersJson: '{"x-synthetic-config":"openai"}',
    providerName: "",
    organization: "",
    project: "",
    apiKeyConfigured: true,
    authTokenConfigured: false,
    source: "database",
  },
  {
    id: "00000000-0000-4000-8000-000000000502",
    name: "复杂目录识别",
    isDefault: false,
    provider: "anthropic",
    model: "claude-sonnet-test",
    discoveredModels: ["claude-sonnet-test"],
    baseUrl: "https://anthropic.synthetic.invalid/v1",
    headersJson: '{"x-synthetic-config":"anthropic"}',
    providerName: "",
    organization: "",
    project: "",
    apiKeyConfigured: false,
    authTokenConfigured: true,
    source: "database",
  },
];

type FixtureProps = { searchParams: Promise<{ empty?: string }> };

async function AgentSettingsFixture({ searchParams }: FixtureProps) {
  const { empty } = await searchParams;
  return (
    <main className="mx-auto max-w-md p-4">
      <WorkspaceSettingsPanel
        settings={empty === "1" ? [] : syntheticSettings}
        canManage
        currentUser={{ name: "Synthetic admin", email: "admin@synthetic.invalid", role: "admin" }}
      />
    </main>
  );
}

/** Test-only fixture; production settings and all writes retain their authorization checks. */
export default function AgentSettingsTestingPage(props: FixtureProps) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={null}>
      <AgentSettingsFixture {...props} />
    </Suspense>
  );
}
