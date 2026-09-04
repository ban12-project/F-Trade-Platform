import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { ContentPanel } from "@/components/workspace/content-panel";
import { DeliveryPanel, LeadPanel, PublicationPanel, QuotationPanel } from "@/components/workspace/closing-panels";
import { ProductMediaPanel } from "@/components/workspace/product-media-panel";
import { ProductPanel } from "@/components/workspace/product-panel";
import { ProjectWorkspace, VideoStageEntry, type ProjectStage } from "@/components/workspace/project-workspace";
import { ProjectMembersPanel } from "@/components/workspace/project-members-panel";
import { WorkspaceCanvasSkeleton } from "@/components/workspace/workspace-canvas-skeleton";
import { WorkspaceSettingsPanel } from "@/components/workspace/workspace-settings-panel";
import { ProjectCanvas } from "@/components/workspace/project-canvas";
import { ProductReferencePanel, RfqPanel } from "@/components/workspace/sales-panels";
import { listStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { getProjectContentCatalogDetail, listCrossProjectContentCandidates, listProjectContentCatalogEntries, listReadyProductContentSources } from "@/lib/content/store";
import { getProductVideoReadiness, listProductMediaAssets } from "@/lib/product/media-store";
import { getProjectProductCatalogDetail, listProjectProductCatalogEntries } from "@/lib/products";
import { listProjectRfqEntries } from "@/lib/sales/store";
import { listProjectDeliveryConfirmations, listProjectLeads, listProjectQuotations } from "@/lib/sales/closing-store";
import { listProjectPublicationData } from "@/lib/social/publication-store";
import { getWorkspaceProject, listProjectReadyProductReferences, listWorkspaceProjects, listWorkspaceTasks } from "@/lib/workspace/store";
import { listReadyVideoProductSourcesWithMedia } from "@/lib/video/product-media-sources";
import { listCrossProjectMarketingVideoCandidates, listProjectMarketingVideoEntries } from "@/lib/video/store";
import { listProjectEvidenceOptions, listWorkspaceProjectMembers } from "@/lib/workspace/access";

const marketingStages: ProjectStage[] = [
  { id: "product", panelKind: "product", label: "产品事实", description: "导入、核验证据并完成 Gate 01。" },
  { id: "content", panelKind: "content", label: "内容", description: "从已核验事实创建并审批营销内容。" },
  { id: "video", panelKind: "video", label: "视频", description: "在独立编辑器完成素材、时间线、预览、版本和提审。" },
  { id: "publication", panelKind: "publication", label: "发布", description: "逐帖人工确认渠道、账户与载荷；平台回执决定最终状态。" },
];
const salesStages: ProjectStage[] = [
  { id: "inbound", panelKind: "lead", label: "入站线索", description: "处理已关联到当前项目的线索与人工跟进。" },
  { id: "rfq", panelKind: "rfq", label: "RFQ", description: "补齐产品身份、数量、目的地与证据。" },
  { id: "quotation", panelKind: "quotation", label: "报价", description: "人工录入商业条款并完成 Gate 02。" },
  { id: "follow-up", panelKind: "lead", label: "跟进", description: "核对规则建议，人工编辑并发送回复，安排下次跟进。" },
  { id: "delivery", panelKind: "delivery", label: "交期确认", description: "客户询问交期时发起并完成 Gate 03。" },
  { id: "opportunity", panelKind: "lead", label: "有效商机", description: "达到条件后仍由业务人员显式确认。" },
];

async function ProjectContent({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ panel?: string; item?: string; view?: string }> }) {
  await connection();
  const [{ projectId }, query, session] = await Promise.all([params, searchParams, requirePermission("workspace:view")]);
  const project = await getWorkspaceProject(projectId, session.user.id);
  if (!project) notFound();
  const shellPromise = Promise.all([listWorkspaceProjects(session.user.id), listWorkspaceTasks(session.user.id), listStoredProductAgentModelSettings(), listWorkspaceProjectMembers(projectId, session.user.id)]);
  const selectedId = z.uuid().safeParse(query.item).success ? query.item : undefined;
  const canProductReview = hasPermission(session.user.role, "product:review");
  const canContentReview = hasPermission(session.user.role, "content:review");
  if (project.kind === "marketing") {
    const [productEntries, contentEntries, contentProducts, contentCopyCandidates, videoProducts, videoEntries, videoCopyCandidates, productDetail, contentDetail, publicationData, evidenceOptions, shell] = await Promise.all([
      listProjectProductCatalogEntries(projectId),
      listProjectContentCatalogEntries(projectId),
      listReadyProductContentSources(projectId),
      listCrossProjectContentCandidates(projectId, session.user.id),
      listReadyVideoProductSourcesWithMedia(projectId),
      listProjectMarketingVideoEntries(projectId),
      listCrossProjectMarketingVideoCandidates(projectId, session.user.id),
      query.panel === "product" && selectedId ? getProjectProductCatalogDetail(projectId, selectedId) : null,
      query.panel === "content" && selectedId ? getProjectContentCatalogDetail(projectId, selectedId) : null,
      listProjectPublicationData(projectId),
      listProjectEvidenceOptions(projectId, session.user.id),
      shellPromise,
    ]);
    const [projects, tasks, settings, members] = shell;
    const membersPanel = <ProjectMembersPanel projectId={projectId} members={members} currentUserId={session.user.id} />;
    const settingsPanel = <WorkspaceSettingsPanel settings={settings} currentUser={session.user} canManage={hasPermission(session.user.role, "settings:manage")} />;
    const productMediaPanel = productDetail?.state === "PRODUCT_READY"
      ? await Promise.all([
          listProductMediaAssets(productDetail.id),
          getProductVideoReadiness(productDetail.id),
        ]).then(([assets, assessment]) => <ProductMediaPanel
          projectId={projectId}
          productId={productDetail.id}
          assets={assets}
          assessment={assessment}
          canReview={canProductReview}
        />)
      : null;
    const panels = {
      product: <div className="flex flex-col gap-6">
        <ProductPanel projectId={projectId} entries={productEntries} detail={productDetail} canReview={canProductReview} agentModelConfigs={settings} evidenceOptions={evidenceOptions} />
        {productMediaPanel}
      </div>,
      content: <ContentPanel projectId={projectId} products={contentProducts} entries={contentEntries} copyCandidates={contentCopyCandidates} detail={contentDetail} canReview={canContentReview} />,
      publication: <PublicationPanel projectId={projectId} {...publicationData} />,
      video: <VideoStageEntry projectId={projectId} count={videoEntries.length} pendingReview={videoEntries.filter((entry) => entry.state === "VIDEO_REVIEW_REQUIRED").length} />,
    };
    if (query.view !== "records") return <ProjectCanvas project={project} projects={projects} tasks={tasks} settingsPanel={settingsPanel} panels={panels} videoEditor={{ products: videoProducts, entries: videoEntries, copyCandidates: videoCopyCandidates, canReview: canContentReview, selectedId }} />;
    const nextTaskStage = tasks.find((task) => task.projectId === projectId && marketingStages.some((stage) => stage.panelKind === task.nodeKind))?.nodeKind;
    const activeStage = marketingStages.some((stage) => stage.id === query.panel) ? query.panel! : nextTaskStage ?? (publicationData.publications.length ? "publication" : videoEntries.length ? "video" : contentEntries.length ? "content" : "product");
    return <ProjectWorkspace project={project} projects={projects} tasks={tasks} settingsPanel={settingsPanel} membersPanel={membersPanel} stages={marketingStages} activeStage={activeStage} panel={panels[activeStage as keyof typeof panels]} />;
  }
  const [rfqs, availableProducts, linkedProducts, quotations, leads, deliveries, shell] = await Promise.all([listProjectRfqEntries(projectId), listReadyProductContentSources(), listProjectReadyProductReferences(projectId), listProjectQuotations(projectId), listProjectLeads(projectId, session.user.id), listProjectDeliveryConfirmations(projectId), shellPromise]);
  const [projects, tasks, settings, members] = shell;
  const membersPanel = <ProjectMembersPanel projectId={projectId} members={members} currentUserId={session.user.id} />;
  const settingsPanel = <WorkspaceSettingsPanel settings={settings} currentUser={session.user} canManage={hasPermission(session.user.role, "settings:manage")} />;
  const panels = {
    rfq: <RfqPanel projectId={projectId} entries={rfqs} selectedId={selectedId} leads={leads} />,
    product: <ProductReferencePanel projectId={projectId} available={availableProducts} linked={linkedProducts} />,
    quotation: <QuotationPanel projectId={projectId} rfqs={rfqs} products={linkedProducts} entries={quotations} canReview={hasPermission(session.user.role, "quotation:review")} />,
    lead: <LeadPanel projectId={projectId} entries={leads} />,
    delivery: <DeliveryPanel projectId={projectId} entries={deliveries} canReview={hasPermission(session.user.role, "delivery:review")} />,
    opportunity: <LeadPanel projectId={projectId} entries={leads.filter((entry) => entry.state === "OPPORTUNITY")} />,
  };
  if (query.view !== "records") return <ProjectCanvas project={project} projects={projects} tasks={tasks} settingsPanel={settingsPanel} panels={panels} />;
  const requestedStage = query.panel;
  const activeStage = salesStages.some((stage) => stage.id === requestedStage)
    ? requestedStage!
    : leads.some((entry) => entry.state === "OPPORTUNITY")
      ? "opportunity"
      : deliveries.some((entry) => entry.state === "DELIVERY_CONFIRMATION_PENDING")
        ? "delivery"
        : leads.length
          ? "follow-up"
          : quotations.length
            ? "quotation"
            : "rfq";
  const activePanelKind = salesStages.find((stage) => stage.id === activeStage)!.panelKind;
  return <ProjectWorkspace project={project} projects={projects} tasks={tasks} settingsPanel={settingsPanel} membersPanel={membersPanel} stages={salesStages} activeStage={activeStage} panel={activeStage === "opportunity" ? panels.opportunity : panels[activePanelKind as keyof typeof panels]} />;
}

export default function ProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ panel?: string; item?: string; view?: string }> }) {
  return <Suspense fallback={<WorkspaceCanvasSkeleton project />}><ProjectContent params={params} searchParams={searchParams} /></Suspense>;
}
