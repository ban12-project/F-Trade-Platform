import "server-only";
import { type ReactNode, Suspense } from "react";
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
import { RecordSelection } from "./record-selection";
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
  selectedLeadId,
}: {
  projectId: string;
  actorId: string;
  role: string | null | undefined;
  stage: string;
  selectedId?: string;
  selectedLeadId?: string;
}) {
  const selection = (found: boolean, children: ReactNode, id = selectedId) => (
    <RecordSelection projectId={projectId} stage={stage} selectedId={id} found={found}>
      {children}
    </RecordSelection>
  );
  switch (stage) {
    case "product": {
      const [entries, detail, settings, evidenceOptions] = await Promise.all([
        listProjectProductCatalogEntries(projectId),
        selectedId ? getProjectProductCatalogDetail(projectId, selectedId) : null,
        readWorkspaceModelSettings(),
        listProjectEvidenceOptions(projectId, actorId),
      ]);
      const canReview = hasPermission(role, "product:review");
      return selection(
        Boolean(detail),
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
        </div>,
      );
    }
    case "content": {
      const [entries, products, copyCandidates, detail] = await Promise.all([
        listProjectContentCatalogEntries(projectId),
        listReadyProductContentSources(projectId),
        listCrossProjectContentCandidates(projectId, actorId),
        selectedId ? getProjectContentCatalogDetail(projectId, selectedId) : null,
      ]);
      return selection(
        Boolean(detail),
        <ContentPanel
          projectId={projectId}
          entries={entries}
          products={products}
          copyCandidates={copyCandidates}
          detail={detail}
          canReview={hasPermission(role, "content:review")}
        />,
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
    case "publication": {
      const data = await listProjectPublicationData(projectId);
      const publication = data.publications.find((entry) => entry.id === selectedId);
      const contentId = publication?.contentRef ?? selectedId;
      const candidates = selectedId
        ? data.candidates.filter((entry) => entry.id === contentId)
        : data.candidates;
      const publications = selectedId
        ? data.publications.filter(
            (entry) => entry.id === selectedId || entry.contentRef === selectedId,
          )
        : data.publications;
      return selection(
        candidates.length > 0 || publications.length > 0,
        <PublicationPanel
          key={selectedId ?? "all"}
          projectId={projectId}
          candidates={candidates}
          channels={data.channels}
          publications={publications}
        />,
      );
    }
    case "rfq": {
      const [entries, leads, available, linked] = await Promise.all([
        listProjectRfqEntries(projectId),
        listProjectLeads(projectId, actorId),
        listReadyProductContentSources(),
        listProjectReadyProductReferences(projectId),
      ]);
      const lead = leads.find((entry) => entry.id === selectedLeadId);
      const linkedRfq = selectedLeadId
        ? entries.find((entry) => entry.formValues.leadId === selectedLeadId)
        : undefined;
      const rfqId = selectedId ?? linkedRfq?.id;
      const found = selectedId
        ? entries.some((entry) => entry.id === selectedId)
        : Boolean(linkedRfq || lead?.state === "LEAD_RECEIVED");
      return selection(
        found,
        <div className="flex flex-col gap-6">
          <RfqPanel
            key={`${rfqId ?? "new"}:${selectedLeadId ?? ""}`}
            projectId={projectId}
            entries={entries}
            selectedId={rfqId}
            selectedLeadId={selectedLeadId}
            leads={leads}
          />
          <ProductReferencePanel projectId={projectId} available={available} linked={linked} />
        </div>,
        selectedId ?? selectedLeadId,
      );
    }
    case "quotation": {
      const [entries, rfqs, products] = await Promise.all([
        listProjectQuotations(projectId),
        listProjectRfqEntries(projectId),
        listProjectReadyProductReferences(projectId),
      ]);
      const selected = selectedId ? entries.filter((entry) => entry.id === selectedId) : entries;
      return selection(
        selected.length > 0,
        <QuotationPanel
          projectId={projectId}
          entries={selected}
          showCreateForm={!selectedId}
          rfqs={rfqs}
          products={products}
          canReview={hasPermission(role, "quotation:review")}
        />,
      );
    }
    case "delivery": {
      const entries = await listProjectDeliveryConfirmations(projectId);
      const selected = selectedId ? entries.filter((entry) => entry.id === selectedId) : entries;
      return selection(
        selected.length > 0,
        <DeliveryPanel
          projectId={projectId}
          entries={selected}
          canReview={hasPermission(role, "delivery:review")}
        />,
      );
    }
    case "inbound":
    case "follow-up":
    case "opportunity": {
      const leads = await listProjectLeads(projectId, actorId);
      const visible = selectedId
        ? leads.filter((entry) => entry.id === selectedId)
        : stage === "opportunity"
          ? leads.filter(
              (entry) =>
                entry.state === "OPPORTUNITY" ||
                (entry.state === "FOLLOW_UP" && entry.lead.score_band === "HOT"),
            )
          : leads;
      return selection(visible.length > 0, <LeadPanel projectId={projectId} entries={visible} />);
    }
    default:
      throw new Error("Unsupported project stage");
  }
}
