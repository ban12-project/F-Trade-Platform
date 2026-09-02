import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { ContentPanel } from "@/components/workspace/content-panel";
import { ProductPanel } from "@/components/workspace/product-panel";
import { WorkspaceCanvasSkeleton } from "@/components/workspace/workspace-canvas-skeleton";
import { WorkspaceSettingsPanel } from "@/components/workspace/workspace-settings-panel";
import { ProjectCanvas } from "@/components/workspace/project-canvas";
import { ProductReferencePanel, QuotationHandoffPanel, RfqPanel } from "@/components/workspace/sales-panels";
import { listStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { getProjectContentCatalogDetail, listCrossProjectContentCandidates, listProjectContentCatalogEntries, listReadyProductContentSources } from "@/lib/content/store";
import { getProjectProductCatalogDetail, listProjectProductCatalogEntries } from "@/lib/products";
import { listProjectRfqEntries } from "@/lib/sales/store";
import { getWorkspaceProject, listProjectReadyProductReferences, listWorkspaceProjects, listWorkspaceTasks } from "@/lib/workspace/store";
import { listCrossProjectMarketingVideoCandidates, listProjectMarketingVideoEntries, listReadyVideoProductSources } from "@/lib/video/store";

async function ProjectContent({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ panel?: string; item?: string }> }) {
  await connection();
  const [{ projectId }, query, session] = await Promise.all([params, searchParams, requirePermission("workspace:view")]);
  const project = await getWorkspaceProject(projectId);
  if (!project) notFound();
  const shellPromise = Promise.all([listWorkspaceProjects(), listWorkspaceTasks(), listStoredProductAgentModelSettings()]);
  const selectedId = z.uuid().safeParse(query.item).success ? query.item : undefined;
  const canReview = hasPermission(session.user.role, "content:review");
  if (project.kind === "marketing") {
    const [productEntries, contentEntries, contentProducts, contentCopyCandidates, videoProducts, videoEntries, videoCopyCandidates, productDetail, contentDetail, shell] = await Promise.all([
      listProjectProductCatalogEntries(projectId),
      listProjectContentCatalogEntries(projectId),
      listReadyProductContentSources(projectId),
      listCrossProjectContentCandidates(projectId),
      listReadyVideoProductSources(projectId),
      listProjectMarketingVideoEntries(projectId),
      listCrossProjectMarketingVideoCandidates(projectId),
      query.panel === "product" && selectedId ? getProjectProductCatalogDetail(projectId, selectedId) : null,
      query.panel === "content" && selectedId ? getProjectContentCatalogDetail(projectId, selectedId) : null,
      shellPromise,
    ]);
    const [projects, tasks, settings] = shell;
    const settingsPanel = <WorkspaceSettingsPanel settings={settings} canManage={hasPermission(session.user.role, "settings:manage")} />;
    return <ProjectCanvas project={project} projects={projects} tasks={tasks} settingsPanel={settingsPanel} panels={{
      product: <ProductPanel projectId={projectId} entries={productEntries} detail={productDetail} canReview={canReview} agentModelConfigs={settings} />,
      content: <ContentPanel projectId={projectId} products={contentProducts} entries={contentEntries} copyCandidates={contentCopyCandidates} detail={contentDetail} canReview={canReview} />,
    }} videoEditor={{ products: videoProducts, entries: videoEntries, copyCandidates: videoCopyCandidates, canReview, selectedId }} />;
  }
  const [rfqs, availableProducts, linkedProducts, shell] = await Promise.all([listProjectRfqEntries(projectId), listReadyProductContentSources(), listProjectReadyProductReferences(projectId), shellPromise]);
  const [projects, tasks, settings] = shell;
  return <ProjectCanvas project={project} projects={projects} tasks={tasks} settingsPanel={<WorkspaceSettingsPanel settings={settings} canManage={hasPermission(session.user.role, "settings:manage")} />} panels={{
    rfq: <RfqPanel projectId={projectId} entries={rfqs} selectedId={selectedId} />,
    product: <ProductReferencePanel projectId={projectId} available={availableProducts} linked={linkedProducts} />,
    quotation: <QuotationHandoffPanel rfqs={rfqs} products={linkedProducts} />,
  }} />;
}

export default function ProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ panel?: string; item?: string }> }) {
  return <Suspense fallback={<WorkspaceCanvasSkeleton project />}><ProjectContent params={params} searchParams={searchParams} /></Suspense>;
}
