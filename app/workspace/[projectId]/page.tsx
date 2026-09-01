import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { ContentPanel } from "@/components/workspace/content-panel";
import { ProductPanel } from "@/components/workspace/product-panel";
import { WorkspaceCanvasSkeleton } from "@/components/workspace/workspace-canvas-skeleton";
import { ProjectCanvas } from "@/components/workspace/project-canvas";
import { ProductReferencePanel, QuotationHandoffPanel, RfqPanel } from "@/components/workspace/sales-panels";
import { getStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { getProjectContentCatalogDetail, listProjectContentCatalogEntries, listReadyProductContentSources } from "@/lib/content/store";
import { getProjectProductCatalogDetail, listProjectProductCatalogEntries } from "@/lib/products";
import { listProjectRfqEntries } from "@/lib/sales/store";
import { getWorkspaceProject, listProjectReadyProductReferences } from "@/lib/workspace/store";
import { listProjectMarketingVideoEntries, listReadyVideoProductSources } from "@/lib/video/store";

async function ProjectContent({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ panel?: string; item?: string }> }) {
  await connection();
  const [{ projectId }, query, session] = await Promise.all([params, searchParams, requirePermission("workspace:view")]);
  const project = await getWorkspaceProject(projectId);
  if (!project) notFound();
  const selectedId = z.uuid().safeParse(query.item).success ? query.item : undefined;
  const canReview = hasPermission(session.user.role, "content:review");
  if (project.kind === "marketing") {
    const [productEntries, contentEntries, contentProducts, videoProducts, videoEntries, settings, productDetail, contentDetail] = await Promise.all([
      listProjectProductCatalogEntries(projectId),
      listProjectContentCatalogEntries(projectId),
      listReadyProductContentSources(projectId),
      listReadyVideoProductSources(projectId),
      listProjectMarketingVideoEntries(projectId),
      getStoredProductAgentModelSettings(),
      query.panel === "product" && selectedId ? getProjectProductCatalogDetail(projectId, selectedId) : null,
      query.panel === "content" && selectedId ? getProjectContentCatalogDetail(projectId, selectedId) : null,
    ]);
    return <ProjectCanvas project={project} panels={{
      product: <ProductPanel projectId={projectId} entries={productEntries} detail={productDetail} canReview={canReview} agentConfigured={Boolean(settings?.apiKeyConfigured || settings?.authTokenConfigured)} />,
      content: <ContentPanel projectId={projectId} products={contentProducts} entries={contentEntries} detail={contentDetail} canReview={canReview} />,
    }} videoEditor={{ products: videoProducts, entries: videoEntries, canReview }} />;
  }
  const [rfqs, availableProducts, linkedProducts] = await Promise.all([listProjectRfqEntries(projectId), listReadyProductContentSources(), listProjectReadyProductReferences(projectId)]);
  return <ProjectCanvas project={project} panels={{
    rfq: <RfqPanel projectId={projectId} entries={rfqs} />,
    product: <ProductReferencePanel projectId={projectId} available={availableProducts} linked={linkedProducts} />,
    quotation: <QuotationHandoffPanel rfqs={rfqs} products={linkedProducts} />,
  }} />;
}

export default function ProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ panel?: string; item?: string }> }) {
  return <Suspense fallback={<WorkspaceCanvasSkeleton project />}><ProjectContent params={params} searchParams={searchParams} /></Suspense>;
}
