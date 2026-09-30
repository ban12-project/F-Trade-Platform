import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { PublicationPanel } from "@/components/workspace/closing-panels";
import { FacebookPublication } from "@/components/workspace/records/facebook-publication";
import { VideoWorkspace } from "@/components/workspace/video-workspace";
import { WorkspaceLoadingSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listProjectPublicationData } from "@/lib/social/publication-store";
import { listReadyVideoProductSourcesWithMedia } from "@/lib/video/product-media-sources";
import {
  listCrossProjectMarketingVideoCandidates,
  listProjectMarketingVideoEntries,
} from "@/lib/video/store";
import { resolveVideoSelection, type VideoSelectionQuery } from "@/lib/video/workspace-selection";
import { workspaceReturnTo } from "@/lib/workspace/navigation";
import { readWorkspaceRecord } from "@/lib/workspace/record-read-model";
import { getWorkspaceProject } from "@/lib/workspace/store";

async function VideoContent({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<VideoSelectionQuery>;
}) {
  await connection();
  const [{ projectId }, query, session] = await Promise.all([
    params,
    searchParams,
    requirePermission("workspace:view"),
  ]);
  if (!z.uuid().safeParse(projectId).success) notFound();
  const project = await getWorkspaceProject(projectId, session.user.id);
  if (project?.kind !== "marketing") notFound();
  if (!query.item && !query.new && !query.product)
    redirect(`/workspace/content?project=${projectId}&type=video`);
  const current =
    typeof query.item === "string" && z.uuid().safeParse(query.item).success
      ? await readWorkspaceRecord(projectId, "video", query.item, session.user.id)
      : null;
  const entries = current
    ? await listProjectMarketingVideoEntries(projectId, undefined, current.id)
    : [];
  const sourceId = current
    ? entries[0]?.productId
    : typeof query.product === "string" && z.uuid().safeParse(query.product).success
      ? query.product
      : undefined;
  const products =
    query.item && !current
      ? []
      : await listReadyVideoProductSourcesWithMedia(projectId, undefined, sourceId);
  const selection = resolveVideoSelection(
    query,
    entries.map((entry) => entry.id),
    products.map((product) => product.id),
  );
  const canWrite =
    project.memberRole !== "viewer" &&
    project.status === "active" &&
    hasPermission(session.user.role, "video:write");
  const copyCandidates =
    selection.mode === "create" && !selection.productId && canWrite
      ? await listCrossProjectMarketingVideoCandidates(projectId, session.user.id)
      : [];
  const active = entries[0];
  const publication =
    active && ["VIDEO_APPROVED", "VIDEO_PUBLISHED"].includes(active.state)
      ? await listProjectPublicationData(projectId, undefined, active.id)
      : null;
  return (
    <VideoWorkspace
      projectId={project.id}
      projectTitle={project.title}
      products={products}
      entries={entries}
      copyCandidates={copyCandidates}
      canWrite={canWrite}
      canReview={canWrite && hasPermission(session.user.role, "content:review")}
      selection={selection}
      returnTo={workspaceReturnTo(query.returnTo)}
      publication={
        active && publication ? (
          <div className="space-y-5">
            <PublicationPanel
              projectId={projectId}
              candidates={publication.candidates}
              channels={publication.channels}
              publications={publication.publications}
            />
            <FacebookPublication
              projectId={projectId}
              contentRef={active.id}
              actorId={session.user.id}
              role={session.user.role}
              canWrite={canWrite}
            />
          </div>
        ) : null
      }
    />
  );
}

export default function VideoPage(props: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<VideoSelectionQuery>;
}) {
  return (
    <Suspense fallback={<WorkspaceLoadingSkeleton project />}>
      <VideoContent {...props} />
    </Suspense>
  );
}
