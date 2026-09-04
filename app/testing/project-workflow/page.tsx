import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  DeliveryPanel,
  LeadPanel,
  PublicationPanel,
  QuotationPanel,
} from "@/components/workspace/closing-panels";
import { ContentPanel } from "@/components/workspace/content-panel";
import { ProductPanel } from "@/components/workspace/product-panel";
import {
  type ProjectStage,
  ProjectWorkspace,
  VideoStageEntry,
} from "@/components/workspace/project-workspace";
import { ProductReferencePanel, RfqPanel } from "@/components/workspace/sales-panels";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import type { ContentCatalogDetail } from "@/lib/content/store";
import type { ProductCatalogDetail } from "@/lib/products";
import type { LeadEntry } from "@/lib/sales/closing-store";
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";

const syntheticMarketingProject: WorkspaceProjectSummary = {
  id: "00000000-0000-4000-8000-000000000202",
  title: "Synthetic project canvas",
  kind: "marketing",
  status: "active",
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const syntheticSalesProject: WorkspaceProjectSummary = {
  ...syntheticMarketingProject,
  id: "00000000-0000-4000-8000-000000000203",
  title: "Synthetic sales canvas",
  kind: "sales",
};
const syntheticProjects: WorkspaceProjectSummary[] = [
  syntheticMarketingProject,
  syntheticSalesProject,
];
const syntheticLead: LeadEntry = {
  id: "00000000-0000-4000-8000-000000000601",
  state: "FOLLOW_UP",
  createdAt: new Date("2026-09-04T08:00:00.000Z"),
  replyAvailable: true,
  confirmedDelivery: {
    id: "30000000-0000-4000-8000-000000000010",
    leadTimeDays: 21,
    validUntil: "2027-09-11T12:00:00.000Z",
  },
  lead: {
    lead_id: "00000000-0000-4000-8000-000000000601",
    channel_ref: "synthetic-facebook",
    conversation_ref: "synthetic-conversation-001",
    status: "follow_up",
    follow_up_context: "quote_sent_read_no_reply",
    score: 35,
    score_band: "WARM",
    score_reasons: [
      { rule_id: "active_inquiry", points: 20 },
      { rule_id: "asks_lead_time", points: 15 },
    ],
    next_action: "ask_one_specific_question",
  },
  timeline: [
    {
      id: "synthetic-message-001",
      direction: "inbound",
      body: "Synthetic buyer asks for the verified lead time.",
      receivedAt: new Date("2026-09-04T08:30:00.000Z"),
      deliveryStatus: "received",
    },
    {
      id: "synthetic-message-002",
      direction: "outbound",
      body: "Synthetic acknowledgement pending channel delivery.",
      receivedAt: new Date("2026-09-04T08:35:00.000Z"),
      deliveryStatus: "queued",
    },
  ],
};

const syntheticProduct = {
  id: "00000000-0000-4000-8000-000000000301",
  productName: "Verified clutch kit",
  internalSku: "SYN-001",
  factOptions: [
    {
      path: "product.product_name",
      label: "product.product_name",
      value: "Verified clutch kit",
      evidenceRef: "evidence-product-001",
    },
  ],
};
const syntheticAgentModels: ProductAgentModelSettings[] = [
  {
    id: "00000000-0000-4000-8000-000000000501",
    name: "日常产品导入",
    isDefault: true,
    provider: "openai",
    model: "gpt-5-mini",
    discoveredModels: ["gpt-5-mini", "gpt-5.6-terra"],
    baseUrl: "",
    headersJson: "{}",
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
    baseUrl: "",
    headersJson: "{}",
    providerName: "",
    organization: "",
    project: "",
    apiKeyConfigured: true,
    authTokenConfigured: false,
    source: "database",
  },
];
const syntheticProductDetail: ProductCatalogDetail = {
  id: syntheticProduct.id,
  state: "PRODUCT_REVIEW_REQUIRED",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  productName: syntheticProduct.productName,
  internalSku: syntheticProduct.internalSku,
  productType: "clutch_kit",
  verificationStatus: "review_required",
  blockingFields: [],
  approvalStatus: "pending",
  approvalId: "00000000-0000-4000-8000-000000000302",
  draft: {
    record_id: syntheticProduct.id,
    source_ref: "source-product-001",
    evidence_refs: ["evidence-product-001"],
    field_evidence: {
      "product.product_name": "evidence-product-001",
      "product.product_type": "evidence-product-001",
      "product.internal_sku": "evidence-product-001",
      "product.oe_numbers": "evidence-product-001",
    },
    verification_status: "review_required",
    blocking_missing_fields: [],
    optional_missing_fields: [],
    product: {
      product_name: syntheticProduct.productName,
      product_type: "clutch_kit",
      internal_sku: syntheticProduct.internalSku,
      oe_numbers: ["OE-SYN-001"],
    },
  },
};
const syntheticContentDetail: ContentCatalogDetail = {
  id: "00000000-0000-4000-8000-000000000303",
  state: "CONTENT_REVISION_REQUIRED",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  contentType: "product",
  productId: syntheticProduct.id,
  productName: syntheticProduct.productName,
  hook: "Ask about this verified clutch kit",
  approvalStatus: "rejected",
  approvalId: "00000000-0000-4000-8000-000000000304",
  content: {
    content_id: "00000000-0000-4000-8000-000000000303",
    product_id: syntheticProduct.id,
    content_type: "product",
    objective: "Generate qualified distributor inquiries",
    target_customer: "Overseas automotive parts distributors",
    platform: "pending-channel-decision",
    hook: "Ask about this verified clutch kit",
    body: "A concise, evidence-grounded product introduction.",
    product_facts: [
      {
        field: "product.product_name",
        value: syntheticProduct.productName,
        evidence_ref: "evidence-product-001",
      },
    ],
    call_to_action: "Contact our sales team",
    hashtags: ["#clutch"],
    visual_instruction: "Show only the supplied product image.",
    status: "revision_required",
  },
};

const marketingStages: ProjectStage[] = [
  {
    id: "product",
    panelKind: "product",
    label: "产品资料",
    description: "导入资料，补全字段并完成产品事实核验。",
  },
  {
    id: "content",
    panelKind: "content",
    label: "营销内容",
    description: "基于已核验产品事实生成、修改并审核营销内容。",
  },
  {
    id: "video",
    panelKind: "video",
    label: "营销视频",
    description: "选择授权素材，在独立编辑器生成剪辑初稿、预览并提审。",
  },
  {
    id: "publication",
    panelKind: "publication",
    label: "发布",
    description: "人工确认渠道、账户与载荷，提交后等待平台回执。",
  },
];
const salesStages: ProjectStage[] = [
  {
    id: "inbound",
    panelKind: "lead",
    label: "客户线索",
    description: "查看已关联到当前项目的询盘、消息和跟进上下文。",
  },
  {
    id: "rfq",
    panelKind: "rfq",
    label: "需求确认",
    description: "补齐产品身份、数量、目的地、证据与产品引用。",
  },
  {
    id: "quotation",
    panelKind: "quotation",
    label: "报价",
    description: "人工录入价格与商业条款，并完成报价确认。",
  },
  {
    id: "follow-up",
    panelKind: "lead",
    label: "跟进",
    description: "人工编辑并发送回复，安排下一次跟进。",
  },
  {
    id: "delivery",
    panelKind: "delivery",
    label: "交期",
    description: "客户询问交期时发起并完成人工确认。",
  },
  {
    id: "opportunity",
    panelKind: "lead",
    label: "商机",
    description: "达到条件后，仍由业务人员显式确认有效商机。",
  },
];

async function ProjectWorkflowFixture({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string; panel?: string }>;
}) {
  const { state, kind, panel } = await searchParams;
  if (kind === "sales") {
    const panels = {
      rfq: (
        <div className="flex flex-col gap-6">
          <RfqPanel projectId={syntheticSalesProject.id} entries={[]} leads={[syntheticLead]} />
          <ProductReferencePanel
            projectId={syntheticSalesProject.id}
            available={[syntheticProduct]}
            linked={[]}
          />
        </div>
      ),
      quotation: (
        <QuotationPanel
          projectId={syntheticSalesProject.id}
          rfqs={[]}
          products={[]}
          entries={[]}
          canReview
        />
      ),
      lead: <LeadPanel projectId={syntheticSalesProject.id} entries={[syntheticLead]} />,
      delivery: <DeliveryPanel projectId={syntheticSalesProject.id} entries={[]} canReview />,
      opportunity: <LeadPanel projectId={syntheticSalesProject.id} entries={[]} />,
    };
    const active = salesStages.some((stage) => stage.id === panel)
      ? panel!
      : panel === "lead"
        ? "follow-up"
        : "inbound";
    const panelKind = salesStages.find((stage) => stage.id === active)!.panelKind;
    const activePanel =
      active === "opportunity" ? panels.opportunity : panels[panelKind as keyof typeof panels];
    return (
      <ProjectWorkspace
        project={syntheticSalesProject}
        projects={syntheticProjects}
        tasks={[]}
        stages={salesStages}
        activeStage={active}
        panel={activePanel}
        basePath="/testing/project-workflow"
      />
    );
  }
  const productDetail = state === "product-review" ? syntheticProductDetail : null;
  const contentDetail = state === "content-revision" ? syntheticContentDetail : null;
  const panels = {
    product: (
      <ProductPanel
        projectId={syntheticMarketingProject.id}
        entries={productDetail ? [productDetail] : []}
        detail={productDetail}
        canReview
        agentModelConfigs={syntheticAgentModels}
      />
    ),
    content: (
      <ContentPanel
        projectId={syntheticMarketingProject.id}
        products={[syntheticProduct]}
        entries={contentDetail ? [contentDetail] : []}
        copyCandidates={[]}
        detail={contentDetail}
        canReview
      />
    ),
    video: (
      <VideoStageEntry
        projectId={syntheticMarketingProject.id}
        count={1}
        pendingReview={state === "review" ? 1 : 0}
      />
    ),
    publication: (
      <PublicationPanel
        projectId={syntheticMarketingProject.id}
        candidates={[]}
        channels={[]}
        publications={[]}
      />
    ),
  };
  const active = marketingStages.some((stage) => stage.id === panel) ? panel! : "product";
  return (
    <ProjectWorkspace
      project={syntheticMarketingProject}
      projects={syntheticProjects}
      tasks={[]}
      stages={marketingStages}
      activeStage={active}
      panel={panels[active as keyof typeof panels]}
      basePath="/testing/project-workflow"
    />
  );
}

/** Test-only fixture: production project access remains permission protected. */
export default function ProjectWorkflowTestingPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string; panel?: string }>;
}) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={null}>
      <ProjectWorkflowFixture searchParams={searchParams} />
    </Suspense>
  );
}
