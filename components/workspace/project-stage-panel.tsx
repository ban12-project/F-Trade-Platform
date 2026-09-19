import "server-only";
import { redirect } from "next/navigation";
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
import { readSalesJourney } from "@/lib/sales/journey-store";
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
import { SalesContext } from "./sales-context";
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
      canWrite={canWrite}
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
    case "rfq":
    case "quotation":
    case "delivery":
    case "inbound":
    case "follow-up":
    case "opportunity": {
      const isLead = ["inbound", "follow-up", "opportunity"].includes(stage);
      const data = await readSalesJourney(projectId, actorId, isLead ? selectedId : undefined);
      const context = (kind: "rfq" | "quotation" | "lead" | "delivery", id?: string) =>
        id ? (
          <SalesContext
            projectId={projectId}
            records={data.records}
            kind={kind}
            id={id}
            canWrite={canWrite}
            hideContinuation={mode === "create"}
          />
        ) : null;
      if (stage === "rfq") {
        if (!canWrite && !selectedId && !selectedLeadId) return readonlyList(data.rfqs, "客户需求");
        const lead = data.leads.find((entry) => entry.id === selectedLeadId);
        const linked = selectedLeadId
          ? data.rfqs.filter((entry) => entry.formValues.leadId === selectedLeadId)
          : [];
        if (mode === "create" && selectedLeadId && linked.length === 1) {
          redirect(workspaceRecordHref(projectId, "rfq", linked[0].id));
        }
        const rfqId = selectedId ?? (linked.length === 1 ? linked[0].id : undefined);
        return selection(
          selectedId
            ? data.rfqs.some((entry) => entry.id === selectedId)
            : linked.length > 0 || lead?.state === "LEAD_RECEIVED",
          <RfqPanel
            key={`${rfqId ?? "new"}:${selectedLeadId ?? ""}`}
            projectId={projectId}
            entries={
              selectedLeadId && linked.length > 1
                ? linked
                : mode === "create" && !rfqId
                  ? []
                  : data.rfqs
            }
            selectedId={rfqId}
            selectedLeadId={linked.length > 1 ? undefined : selectedLeadId}
            mode={linked.length > 1 ? "collection" : mode === "create" ? "create" : "collection"}
            leads={data.leads}
          >
            {context(rfqId ? "rfq" : "lead", rfqId ?? selectedLeadId)}
          </RfqPanel>,
          selectedId ?? selectedLeadId,
        );
      }
      if (stage === "quotation") {
        if (!canWrite && !selectedId && !selectedRfqId)
          return readonlyList(data.quotations, "人工报价");
        const [products, available] = await Promise.all([
          listProjectReadyProductReferences(projectId),
          !selectedId ? listReadyProductContentSources() : [],
        ]);
        const quoteRfqs = selectedRfqId
          ? data.rfqs.filter((entry) => entry.id === selectedRfqId && entry.state === "RFQ_READY")
          : data.rfqs;
        const selected = selectedId
          ? data.quotations.filter((entry) => entry.id === selectedId)
          : mode === "create" || selectedRfqId
            ? []
            : data.quotations;
        return selection(
          selectedRfqId ? quoteRfqs.length > 0 : selected.length > 0,
          <div className="space-y-6">
            {context(selectedId ? "quotation" : "rfq", selectedId ?? selectedRfqId)}
            <QuotationPanel
              projectId={projectId}
              entries={selected}
              showCreateForm={
                !selectedId && (mode === "create" || Boolean(selectedRfqId) || !selected.length)
              }
              rfqs={quoteRfqs}
              products={products}
              canReview={canWrite && hasPermission(role, "quotation:review")}
              collection={!selectedId && !selectedRfqId && mode !== "create"}
            />
            {!selectedId && (mode === "create" || selectedRfqId || !selected.length) ? (
              <ProductReferencePanel
                projectId={projectId}
                available={available}
                linked={products}
              />
            ) : null}
          </div>,
          selectedId ?? selectedRfqId,
        );
      }
      if (stage === "delivery") {
        if (!selectedId) return readonlyList(data.deliveries, "交期确认");
        const entries = data.deliveries.filter((entry) => entry.id === selectedId);
        return selection(
          entries.length > 0,
          <div className="space-y-6">
            {context("delivery", selectedId)}
            <DeliveryPanel
              projectId={projectId}
              entries={entries}
              canReview={canWrite && hasPermission(role, "delivery:review")}
            />
          </div>,
        );
      }
      const visible = selectedId
        ? data.leads.filter((entry) => entry.id === selectedId)
        : stage === "opportunity"
          ? data.leads.filter(
              (entry) =>
                entry.state === "OPPORTUNITY" ||
                (entry.state === "FOLLOW_UP" && entry.lead.score_band === "HOT"),
            )
          : data.leads;
      if (!selectedId) return readonlyList(visible, "客户会话");
      return selection(
        visible.length > 0,
        <div className="space-y-6">
          {context("lead", selectedId)}
          <LeadPanel
            projectId={projectId}
            entries={visible}
            deliveries={data.deliveries.filter((item) =>
              visible.some((entry) => entry.lead.delivery_confirmation_ref === item.id),
            )}
          />
        </div>,
      );
    }
    default:
      throw new Error("Unsupported project stage");
  }
}
