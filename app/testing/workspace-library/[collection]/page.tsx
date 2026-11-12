import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceLibrary } from "@/components/workspace/workspace-library";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { deriveWorkspaceLibrary } from "@/lib/workspace/library-model";
import { parseLibrarySearch } from "@/lib/workspace/library-search";
import { librarySnapshot } from "@/tests/fixtures/workspace-library";
import { NavigationEditor } from "../../workspace-navigation/editor";

type Props = {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{
    project?: string;
    type?: string;
    state?: string;
    q?: string | string[];
    empty?: string;
    long?: string;
    scope?: "viewer" | "archived" | "marketing";
  }>;
};
async function Content({ searchParams, params }: Props) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  const query = await searchParams;
  const { collection } = await params;
  if (!["customers", "content", "products"].includes(collection)) notFound();
  const selectedCollection = collection as "customers" | "content" | "products";
  const search = parseLibrarySearch(query.q);
  const snapshot =
    query.long || query.scope
      ? {
          ...librarySnapshot,
          projects: librarySnapshot.projects.map((project) => ({
            ...project,
            title: query.long ? `SyntheticProject${"X".repeat(104)}` : project.title,
            kind: query.scope === "marketing" ? ("marketing" as const) : project.kind,
            memberRole: query.scope === "viewer" ? ("viewer" as const) : project.memberRole,
            status: query.scope === "archived" ? ("archived" as const) : project.status,
          })),
        }
      : librarySnapshot;
  return (
    <WorkspaceShell projects={snapshot.projects}>
      <main id="main-content" className="p-6">
        <WorkspaceLibrary
          collection={selectedCollection}
          projects={snapshot.projects}
          records={query.empty ? [] : deriveWorkspaceLibrary(snapshot)}
          projectId={query.project}
          recordType={query.type}
          state={query.state}
          search={search.q}
          searchError={search.error}
          basePath={`/testing/workspace-library/${collection}`}
        />
        <NavigationEditor href={`/testing/workspace-library/${collection}`} />
      </main>
    </WorkspaceShell>
  );
}
export default function Page(props: Props) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
