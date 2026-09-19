import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { VideoWorkspace } from "@/components/workspace/video-workspace";
import { WorkspaceLoadingSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listReadyVideoProductSourcesWithMedia } from "@/lib/video/product-media-sources";
import {
  listCrossProjectMarketingVideoCandidates,
  listProjectMarketingVideoEntries,
} from "@/lib/video/store";
import { resolveVideoSelection, type VideoSelectionQuery } from "@/lib/video/workspace-selection";
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
  const project = await getWorkspaceProject(projectId, session.user.id);
  if (!project || project.kind !== "marketing") notFound();
  const [products, entries] = await Promise.all([
    listReadyVideoProductSourcesWithMedia(projectId),
    listProjectMarketingVideoEntries(projectId),
  ]);
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
