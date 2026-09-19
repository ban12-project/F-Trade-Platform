import "server-only";
import { type ReactNode, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/authz";
import {
  getProjectContentCatalogDetail,
  listCrossProjectContentCandidates,
  listProjectContentCatalogEntries,
  listReadyProductContentSources,
} from "@/lib/content/store";
import { listProductEvidencePreviews } from "@/lib/product/evidence-preview";
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
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import { readWorkspaceModelSettings } from "@/lib/workspace/read-model";
import { listProjectReadyProductReferences } from "@/lib/workspace/store";
import { DeliveryPanel, LeadPanel, PublicationPanel, QuotationPanel } from "./closing-panels";
import { ContentPanel } from "./content-panel";
import { ProductMediaPanel } from "./product-media-panel";
import { ProductPanel } from "./product-panel";
import { VideoStageEntry } from "./project-workspace";
import { ReadOnlyRecordList, RecordSelection } from "./record-selection";
import { ProductReferencePanel, RfqPanel } from "./sales-panels";
import { WorkspaceLink } from "./workspace-link";
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
async function ContentPublication({
  projectId,
  contentId,
}: {
  projectId: string;
  contentId: string;
}) {
  const data = await listProjectPublicationData(projectId);
  return (
    <PublicationPanel
      projectId={projectId}
      candidates={data.candidates.filter((item) => item.id === contentId)}
      channels={data.channels}
      publications={data.publications.filter((item) => item.contentRef === contentId)}
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
  selectedProductId,
  selectedRfqId,
  canWrite,
  mode,
}: {
  projectId: string;
  actorId: string;
  role: string | null | undefined;
  stage: string;
  selectedId?: string;
  selectedLeadId?: string;
  selectedProductId?: string;
  selectedRfqId?: string;
  canWrite: boolean;
  mode?: "record" | "create";
}) {
  const readonlyList = (entries: Array<{ id: string }>, label: string) => (
    <ReadOnlyRecordList
      projectId={projectId}
      stage={stage}
      entries={entries.map((entry) => ({
        id: entry.id,
        label: `${label} ${entry.id.slice(0, 8)}`,
      }))}
    />
  );
  const selection = (found: boolean, children: ReactNode, id = selectedId) => (
    <RecordSelection projectId={projectId} stage={stage} selectedId={id} found={found}>
      {canWrite ? (
        children
      ) : (
        <div className="space-y-4">
          <p role="status" className="text-sm text-muted-foreground">
            当前为只读视图。请由项目编辑者处理写入或审核。
          </p>
          <fieldset disabled className="min-w-0 space-y-4 border-0 p-0">
            {children}
          </fieldset>
        </div>
      )}
    </RecordSelection>
  );
  switch (stage) {
    case "product": {
      const [entries, detail, settings, evidenceOptions, sourceDocuments] = await Promise.all([
        listProjectProductCatalogEntries(projectId),
        selectedId ? getProjectProductCatalogDetail(projectId, selectedId) : null,
        readWorkspaceModelSettings(),
        listProjectEvidenceOptions(projectId, actorId),
        selectedId ? listProductEvidencePreviews(projectId, selectedId, actorId) : [],
      ]);
      if (!canWrite && !selectedId) return readonlyList(entries, "产品资料");
      const canReview = canWrite && hasPermission(role, "product:review");
      return selection(
        Boolean(detail),
        <div className="flex flex-col gap-6">
          <ProductPanel
            projectId={projectId}
            entries={entries}
            detail={detail}
            canReview={canReview}
            mode={mode === "create" ? "create" : "collection"}
            agentModelConfigs={settings}
            evidenceOptions={evidenceOptions}
            sourceDocuments={sourceDocuments}
          >
            {detail?.state === "PRODUCT_READY" && canWrite ? (
              <Card>
                <CardHeader>
                  <CardTitle>产品已核实，可以制作内容</CardTitle>
                  <CardDescription>
                    使用当前产品已有的事实开始图文，之后再审核具体文案。
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button
                    render={
                      <WorkspaceLink
                        href={workspaceCreateHref(projectId, "content", {
                          kind: "product",
                          id: detail.id,
                        })}
                      />
                    }
                  >
                    制作图文内容
                  </Button>
                </CardFooter>
              </Card>
            ) : null}
          </ProductPanel>
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
      if (!canWrite && !selectedId && !selectedProductId) return readonlyList(entries, "营销内容");
      const sources = selectedProductId
        ? products.filter((product) => product.id === selectedProductId)
        : products;
      return selection(
        selectedProductId ? sources.length > 0 : Boolean(detail),
        <ContentPanel
          projectId={projectId}
          entries={entries}
          products={sources}
          mode={mode === "create" || selectedProductId ? "create" : "collection"}
          copyCandidates={copyCandidates}
          detail={detail}
          canReview={canWrite && hasPermission(role, "content:review")}
        >
          {detail ? (
            <Button
              variant="outline"
              render={
                <WorkspaceLink href={workspaceRecordHref(projectId, "product", detail.productId)} />
              }
            >
              查看来源产品
            </Button>
          ) : null}
          {detail && ["CONTENT_APPROVED", "CONTENT_PUBLISHED"].includes(detail.state) ? (
            <Suspense fallback={<WorkspacePanelSkeleton label="正在加载当前内容的发布状态" />}>
              <ContentPublication projectId={projectId} contentId={detail.id} />
            </Suspense>
          ) : null}
        </ContentPanel>,
        selectedId ?? selectedProductId,
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
      if (!canWrite && !selectedId)
        return readonlyList([...data.publications, ...data.candidates], "发布记录或内容");
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
      if (!canWrite && !selectedId && !selectedLeadId) return readonlyList(entries, "客户询盘");
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
            entries={
              mode === "create" && !rfqId
                ? []
                : selectedId
                  ? entries.filter((entry) => entry.id === selectedId)
                  : entries
            }
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
      if (!canWrite && !selectedId && !selectedRfqId) return readonlyList(entries, "人工报价");
      const selected = selectedId ? entries.filter((entry) => entry.id === selectedId) : entries;
      const quoteRfqs = selectedRfqId
        ? rfqs.filter((rfq) => rfq.id === selectedRfqId && rfq.state === "RFQ_READY")
        : rfqs;
      return selection(
        selectedRfqId ? quoteRfqs.length > 0 : selected.length > 0,
        <QuotationPanel
          projectId={projectId}
          entries={selectedRfqId ? [] : selected}
          showCreateForm={!selectedId}
          rfqs={quoteRfqs}
          products={products}
          canReview={canWrite && hasPermission(role, "quotation:review")}
        />,
        selectedId ?? selectedRfqId,
      );
    }
    case "delivery": {
      const entries = await listProjectDeliveryConfirmations(projectId);
      if (!canWrite && !selectedId) return readonlyList(entries, "交期确认");
      const selected = selectedId ? entries.filter((entry) => entry.id === selectedId) : entries;
      return selection(
        selected.length > 0,
        <DeliveryPanel
          projectId={projectId}
          entries={selected}
          canReview={canWrite && hasPermission(role, "delivery:review")}
        />,
      );
    }
    case "inbound":
    case "follow-up":
    case "opportunity": {
      const leads = await listProjectLeads(projectId, actorId);
      if (!canWrite && !selectedId) return readonlyList(leads, "客户线索");
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
