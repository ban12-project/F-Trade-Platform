import { Suspense } from "react";
import { notFound } from "next/navigation";

import { ConsoleLoading } from "@/components/console-loading";
import { ProjectCanvas } from "@/components/workspace/project-canvas";
import { requirePermission } from "@/lib/auth-guard";
import { getWorkspaceProject } from "@/lib/workspace/store";

async function ProjectContent({ projectId }: { projectId: string }) {
  await requirePermission("workspace:view");
  const project = await getWorkspaceProject(projectId);
  if (!project) notFound();
  return <ProjectCanvas project={project} />;
}

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  return <Suspense fallback={<ConsoleLoading />}>{params.then(({ projectId }) => <ProjectContent projectId={projectId} />)}</Suspense>;
}
