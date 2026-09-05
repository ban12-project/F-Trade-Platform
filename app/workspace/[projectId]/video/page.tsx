import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";

import { VideoWorkspace } from "@/components/workspace/video-workspace";
import { WorkspaceLoadingSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listReadyVideoProductSourcesWithMedia } from "@/lib/video/product-media-sources";
import {
  listCrossProjectMarketingVideoCandidates,
  listProjectMarketingVideoEntries,
} from "@/lib/video/store";
import { getWorkspaceProject } from "@/lib/workspace/store";

async function VideoContent({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  await connection();
  const [{ projectId }, query, session] = await Promise.all([
    params,
    searchParams,
    requirePermission("workspace:view"),
  ]);
  const project = await getWorkspaceProject(projectId, session.user.id);
  if (!project || project.kind !== "marketing") notFound();
  const [products, entries, copyCandidates] = await Promise.all([
    listReadyVideoProductSourcesWithMedia(projectId),
    listProjectMarketingVideoEntries(projectId),
    listCrossProjectMarketingVideoCandidates(projectId, session.user.id),
  ]);
  return (
    <VideoWorkspace
      projectId={project.id}
      projectTitle={project.title}
      products={products}
      entries={entries}
      copyCandidates={copyCandidates}
      canReview={hasPermission(session.user.role, "content:review")}
      selectedId={z.uuid().safeParse(query.item).success ? query.item : undefined}
    />
  );
}

export default function VideoPage(props: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  return (
    <Suspense fallback={<WorkspaceLoadingSkeleton project />}>
      <VideoContent {...props} />
    </Suspense>
  );
}
