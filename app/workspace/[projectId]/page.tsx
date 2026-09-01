import { Suspense } from "react";
import { notFound } from "next/navigation";

import { WorkspaceCanvasSkeleton } from "@/components/workspace/workspace-canvas-skeleton";
import { ProjectCanvas } from "@/components/workspace/project-canvas";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { getWorkspaceProject } from "@/lib/workspace/store";
import { listProjectMarketingVideoEntries, listReadyVideoProductSources } from "@/lib/video/store";

async function ProjectContent({ projectId }: { projectId: string }) {
  const session = await requirePermission("workspace:view");
  const [project, products, entries] = await Promise.all([getWorkspaceProject(projectId), listReadyVideoProductSources(), listProjectMarketingVideoEntries(projectId)]);
  if (!project) notFound();
  return <ProjectCanvas project={project} videoEditor={{ products, entries, canReview: hasPermission(session.user.role, "content:review") }} />;
}

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  return <Suspense fallback={<WorkspaceCanvasSkeleton project />}>{params.then(({ projectId }) => <ProjectContent projectId={projectId} />)}</Suspense>;
}
