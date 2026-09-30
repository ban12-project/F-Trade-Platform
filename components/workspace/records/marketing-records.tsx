import "server-only";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/authz";
import {
  getProjectContentCatalogDetail,
  listCrossProjectContentCandidates,
  listReadyProductContentSources,
} from "@/lib/content/store";
import { listProductEvidencePreviews } from "@/lib/product/evidence-preview";
import { getProductVideoReadiness, listProductMediaAssets } from "@/lib/product/media-store";
import { getProjectProductCatalogDetail } from "@/lib/products";
import { listProjectPublicationData } from "@/lib/social/publication-store";
import { listProjectEvidenceOptions } from "@/lib/workspace/access";
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import { readWorkspaceModelSettings } from "@/lib/workspace/read-model";
import { PublicationPanel } from "../closing-panels";
import { ContentCreatePanel } from "../content-create-panel";
import { ContentReview } from "../content-review";
import { ProductIntakePanel } from "../product-intake-panel";
import { ProductMediaPanel } from "../product-media-panel";
import { ProductReview } from "../product-review";
import type { RecordContext } from "../record-page";
import { WorkspaceLink } from "../workspace-link";
import { WorkspacePanelSkeleton } from "../workspace-loading-skeleton";
import { FacebookPublication } from "./facebook-publication";

async function ProductMedia({ context }: { context: RecordContext }) {
  const [assets, assessment] = await Promise.all([
    listProductMediaAssets(context.recordId!),
    getProductVideoReadiness(context.recordId!),
  ]);
  return (
    <ProductMediaPanel
      projectId={context.projectId}
      productId={context.recordId!}
      assets={assets}
      assessment={assessment}
      canReview={context.canWrite && hasPermission(context.session.user.role, "product:review")}
    />
  );
}
export async function ProductCreate({ context }: { context: RecordContext }) {
  const [settings, evidenceOptions] = await Promise.all([
    readWorkspaceModelSettings(),
    listProjectEvidenceOptions(context.projectId, context.session.user.id),
  ]);
  return (
    <ProductIntakePanel
      projectId={context.projectId}
      canReview={hasPermission(context.session.user.role, "product:review")}
      agentModelConfigs={settings}
      evidenceOptions={evidenceOptions}
    />
  );
}
export async function ProductRecord({ context }: { context: RecordContext }) {
  const { projectId, recordId, session, canWrite, returnTo } = context;
  const detail = await getProjectProductCatalogDetail(projectId, recordId!);
  if (!detail) notFound();
  const [evidenceOptions, sourceDocuments] = await Promise.all([
    listProjectEvidenceOptions(projectId, session.user.id),
    listProductEvidencePreviews(projectId, recordId!, session.user.id),
  ]);
  return (
    <div className="space-y-6">
      <ProductReview
        key={detail.id + ":" + detail.version}
        projectId={projectId}
        detail={detail}
        canReview={canWrite && hasPermission(session.user.role, "product:review")}
        evidenceOptions={evidenceOptions}
        sourceDocuments={sourceDocuments}
      />
      {detail.state === "PRODUCT_READY" && canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            render={
              <WorkspaceLink
                href={workspaceCreateHref(
                  projectId,
                  "content",
                  { kind: "product", id: detail.id },
                  returnTo,
                )}
              />
            }
          >
            制作图文内容
          </Button>
          <Button
            variant="outline"
            render={
              <WorkspaceLink
                href={workspaceCreateHref(
                  projectId,
                  "video",
                  { kind: "product", id: detail.id },
                  returnTo,
                )}
              />
            }
          >
            按需制作视频
          </Button>
        </div>
      ) : null}
      {detail.state === "PRODUCT_READY" ? (
        <Suspense fallback={<WorkspacePanelSkeleton label="正在加载产品素材" />}>
          <ProductMedia context={context} />
        </Suspense>
      ) : null}
    </div>
  );
}
export async function ContentCreate({ context }: { context: RecordContext }) {
  const [products, copyCandidates] = await Promise.all([
    listReadyProductContentSources(context.projectId, context.sourceId),
    context.sourceId
      ? []
      : listCrossProjectContentCandidates(context.projectId, context.session.user.id),
  ]);
  if (context.sourceId && !products.some((item) => item.id === context.sourceId)) notFound();
  return (
    <ContentCreatePanel
      projectId={context.projectId}
      products={products}
      copyCandidates={copyCandidates}
    />
  );
}
async function ContentPublication({
  context,
  contentId,
}: {
  context: RecordContext;
  contentId: string;
}) {
  const data = await listProjectPublicationData(context.projectId, undefined, contentId);
  return (
    <div className="space-y-5">
      <PublicationPanel
        projectId={context.projectId}
        candidates={data.candidates}
        channels={data.channels}
        publications={data.publications}
      />
      <FacebookPublication
        projectId={context.projectId}
        contentRef={contentId}
        actorId={context.session.user.id}
        role={context.session.user.role}
        canWrite={context.canWrite}
      />
    </div>
  );
}
export async function ContentRecord({ context }: { context: RecordContext }) {
  const detail = await getProjectContentCatalogDetail(context.projectId, context.recordId!);
  if (!detail) notFound();
  const products =
    detail.state === "CONTENT_REVISION_REQUIRED"
      ? await listReadyProductContentSources(context.projectId, detail.productId)
      : [];
  return (
    <div className="space-y-5">
      <ContentReview
        key={detail.id + ":" + detail.version}
        projectId={context.projectId}
        detail={detail}
        product={products.find((product) => product.id === detail.productId)}
        canReview={context.canWrite && hasPermission(context.session.user.role, "content:review")}
      />
      <Button
        variant="outline"
        render={
          <WorkspaceLink
            href={workspaceRecordHref(
              context.projectId,
              "product",
              detail.productId,
              context.returnTo,
            )}
          />
        }
      >
        查看来源产品
      </Button>
      {["CONTENT_APPROVED", "CONTENT_PUBLISHED"].includes(detail.state) ? (
        <Suspense fallback={<WorkspacePanelSkeleton label="正在加载发布与回执" />}>
          <ContentPublication context={context} contentId={detail.id} />
        </Suspense>
      ) : null}
    </div>
  );
}
export async function PublicationRecord({ context }: { context: RecordContext }) {
  const publication = context.record?.publication;
  if (!publication) notFound();
  const data = await listProjectPublicationData(
    context.projectId,
    undefined,
    publication.contentRef,
  );
  return (
    <PublicationPanel
      projectId={context.projectId}
      candidates={[]}
      channels={data.channels}
      publications={data.publications.filter((item) => item.id === publication.id)}
    />
  );
}
