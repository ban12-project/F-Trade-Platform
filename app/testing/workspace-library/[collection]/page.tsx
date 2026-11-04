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
    q?: string;
    empty?: string;
  }>;
};
async function Content({ searchParams, params }: Props) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  const query = await searchParams;
  const { collection } = await params;
  if (!["customers", "content", "products"].includes(collection)) notFound();
  const selectedCollection = collection as "customers" | "content" | "products";
  return (
    <WorkspaceShell projects={librarySnapshot.projects}>
      <main id="main-content" className="p-6">
        <WorkspaceLibrary
          collection={selectedCollection}
          projects={librarySnapshot.projects}
          records={query.empty ? [] : deriveWorkspaceLibrary(librarySnapshot)}
          projectId={query.project}
          recordType={query.type}
          state={query.state}
          search={parseLibrarySearch(query.q)}
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
