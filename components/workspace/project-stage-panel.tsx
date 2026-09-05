import "server-only";
import { Suspense } from "react";
import { hasPermission } from "@/lib/authz";
import {
  getProjectContentCatalogDetail,
  listCrossProjectContentCandidates,
  listProjectContentCatalogEntries,
  listReadyProductContentSources,
} from "@/lib/content/store";
import { getProductVideoReadiness, listProductMediaAssets } from "@/lib/product/media-store";
import { getProjectProductCatalogDetail, listProjectProductCatalogEntries } from "@/lib/products";
import {
  listProjectDeliveryConfirmations,
  listProjectLeads,
  listProjectQuotations,
} from "@/lib/sales/closing-store";
import { listProjectRfqEntries } from "@/lib/sales/store";
import { listProjectPublicationData } from "@/lib/social/publication-store";
import { listProjectMarketingVideoEntries } from "@/lib/video/store";
import { listProjectEvidenceOptions } from "@/lib/workspace/access";
import { readWorkspaceModelSettings } from "@/lib/workspace/read-model";
import { listProjectReadyProductReferences } from "@/lib/workspace/store";
import { DeliveryPanel, LeadPanel, PublicationPanel, QuotationPanel } from "./closing-panels";
import { ContentPanel } from "./content-panel";
import { ProductMediaPanel } from "./product-media-panel";
import { ProductPanel } from "./product-panel";
import { VideoStageEntry } from "./project-workspace";
import { ProductReferencePanel, RfqPanel } from "./sales-panels";
import { WorkspacePanelSkeleton } from "./workspace-loading-skeleton";

async function ProductMedia({
  projectId,
  productId,
  canReview,
}: {
  projectId: string;
  productId: string;
  canReview: boolean;
}) {
  const [assets, assessment] = await Promise.all([
    listProductMediaAssets(productId),
    getProductVideoReadiness(productId),
  ]);
  return (
    <ProductMediaPanel
      projectId={projectId}
      productId={productId}
      assets={assets}
      assessment={assessment}
      canReview={canReview}
    />
  );
}
export async function ProjectStagePanel({
  projectId,
  actorId,
  role,
  stage,
  selectedId,
}: {
  projectId: string;
  actorId: string;
  role: string | null | undefined;
  stage: string;
  selectedId?: string;
}) {
  switch (stage) {
    case "product": {
      const [entries, detail, settings, evidenceOptions] = await Promise.all([
        listProjectProductCatalogEntries(projectId),
        selectedId ? getProjectProductCatalogDetail(projectId, selectedId) : null,
        readWorkspaceModelSettings(),
        listProjectEvidenceOptions(projectId, actorId),
      ]);
      const canReview = hasPermission(role, "product:review");
      return (
        <div className="flex flex-col gap-6">
          <ProductPanel
            projectId={projectId}
            entries={entries}
            detail={detail}
            canReview={canReview}
            agentModelConfigs={settings}
            evidenceOptions={evidenceOptions}
          />
          {detail?.state === "PRODUCT_READY" ? (
            <Suspense fallback={<WorkspacePanelSkeleton label="正在加载产品素材" />}>
              <ProductMedia projectId={projectId} productId={detail.id} canReview={canReview} />
            </Suspense>
          ) : null}
        </div>
      );
    }
    case "content": {
      const [entries, products, copyCandidates, detail] = await Promise.all([
        listProjectContentCatalogEntries(projectId),
        listReadyProductContentSources(projectId),
        listCrossProjectContentCandidates(projectId, actorId),
        selectedId ? getProjectContentCatalogDetail(projectId, selectedId) : null,
      ]);
      return (
        <ContentPanel
          projectId={projectId}
          entries={entries}
          products={products}
          copyCandidates={copyCandidates}
          detail={detail}
          canReview={hasPermission(role, "content:review")}
        />
      );
    }
    case "video": {
      const entries = await listProjectMarketingVideoEntries(projectId);
      return (
        <VideoStageEntry
          projectId={projectId}
          count={entries.length}
          pendingReview={entries.filter((entry) => entry.state === "VIDEO_REVIEW_REQUIRED").length}
        />
      );
    }
    case "publication":
      return (
        <PublicationPanel
          projectId={projectId}
          {...(await listProjectPublicationData(projectId))}
        />
      );
    case "rfq": {
      const [entries, leads, available, linked] = await Promise.all([
        listProjectRfqEntries(projectId),
        listProjectLeads(projectId, actorId),
        listReadyProductContentSources(),
        listProjectReadyProductReferences(projectId),
      ]);
      return (
        <div className="flex flex-col gap-6">
          <RfqPanel projectId={projectId} entries={entries} selectedId={selectedId} leads={leads} />
          <ProductReferencePanel projectId={projectId} available={available} linked={linked} />
        </div>
      );
    }
    case "quotation": {
      const [entries, rfqs, products] = await Promise.all([
        listProjectQuotations(projectId),
        listProjectRfqEntries(projectId),
        listProjectReadyProductReferences(projectId),
      ]);
      return (
        <QuotationPanel
          projectId={projectId}
          entries={entries}
          rfqs={rfqs}
          products={products}
          canReview={hasPermission(role, "quotation:review")}
        />
      );
    }
    case "delivery":
      return (
        <DeliveryPanel
          projectId={projectId}
          entries={await listProjectDeliveryConfirmations(projectId)}
          canReview={hasPermission(role, "delivery:review")}
        />
      );
    case "inbound":
    case "follow-up":
    case "opportunity": {
      const leads = await listProjectLeads(projectId, actorId);
      return (
        <LeadPanel
          projectId={projectId}
          entries={
            stage === "opportunity" ? leads.filter((entry) => entry.state === "OPPORTUNITY") : leads
          }
        />
      );
    }
    default:
      throw new Error("Unsupported project stage");
  }
}
