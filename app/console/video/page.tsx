import { Suspense } from "react";

import { ConsoleLoading } from "@/components/console-loading";
import { requireRole } from "@/lib/auth-guard";
import { listVideoProviderSettings } from "@/lib/video/provider-config-store";
import { listReadyVideoProductSources, listVideoWorkspaceEntries } from "@/lib/video/store";

import { VideoGenerationPanel, type EligibleVideoModel } from "./video-generation-panel";
import { VideoWorkspacePanel } from "./video-workspace-panel";

async function AuthorizedVideoWorkspace() {
  await requireRole("admin");
  const [products, entries, providerSettings] = await Promise.all([listReadyVideoProductSources(), listVideoWorkspaceEntries(), listVideoProviderSettings()]);
  const plans = entries.filter((entry) => entry.state === "VIDEO_APPROVED" && entry.approvalStatus === "approved").map((entry) => ({ id: entry.id, objective: entry.objective, productName: entry.productName }));
  const models: EligibleVideoModel[] = providerSettings.flatMap((setting) => setting.enabled && setting.credentialConfigured ? setting.models.flatMap((model) => model.enabled && model.verifiedAt && model.verificationRef && model.capabilities.includes("text-to-video") ? [{ provider: setting.provider, modelId: model.modelId, aspectRatios: model.aspectRatios, resolutions: model.resolutions, durationMaximumSeconds: model.durationSeconds.max }] : []) : []);
  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6"><VideoWorkspacePanel products={products} entries={entries} /><div className="px-4 pb-8 md:px-6 lg:px-8"><VideoGenerationPanel plans={plans} models={models} /></div></div>;
}

export default function VideoPage() {
  return <Suspense fallback={<ConsoleLoading />}><AuthorizedVideoWorkspace /></Suspense>;
}
