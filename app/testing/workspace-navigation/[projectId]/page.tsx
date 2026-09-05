import { setTimeout as delay } from "node:timers/promises";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProjectWorkspace } from "@/components/workspace/project-workspace";
import { WorkspaceLoadingSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { marketingStages } from "@/lib/workspace/stages";
import { navigationProject } from "../data";
import { NavigationEditor } from "../editor";

type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<{ slow?: string }> };
async function Content({ params, searchParams }: Props) {
  await connection();
  const [route, query] = await Promise.all([params, searchParams]);
  if (route.projectId !== navigationProject.id) notFound();
  // Deliberately slow, synthetic-only route: this is a persistence regression, not a production benchmark.
  if (query.slow === "1") await delay(1500);
  return (
    <ProjectWorkspace
      project={navigationProject}
      tasks={[]}
      stages={marketingStages}
      activeStage="product"
      basePath={`/testing/workspace-navigation/${navigationProject.id}`}
      panel={<NavigationEditor href="/testing/workspace-navigation" />}
    />
  );
}
export default function Page(props: Props) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={<WorkspaceLoadingSkeleton project />}>
      <Content {...props} />
    </Suspense>
  );
}
