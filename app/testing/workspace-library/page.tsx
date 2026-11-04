import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceLibrary } from "@/components/workspace/workspace-library";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { deriveWorkspaceLibrary } from "@/lib/workspace/library-model";
import { parseLibrarySearch } from "@/lib/workspace/library-search";
import { librarySnapshot } from "@/tests/fixtures/workspace-library";

type Props = {
  searchParams: Promise<{
    project?: string;
    type?: string;
    state?: string;
    q?: string;
    collection?: string;
    empty?: string;
  }>;
};
async function Content({ searchParams }: Props) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  const query = await searchParams;
  const collection =
    query.collection === "customers" || query.collection === "content"
      ? query.collection
      : "products";
  return (
    <WorkspaceShell projects={librarySnapshot.projects}>
      <main id="main-content" className="p-6">
        <WorkspaceLibrary
          collection={collection}
          projects={librarySnapshot.projects}
          records={query.empty ? [] : deriveWorkspaceLibrary(librarySnapshot)}
          projectId={query.project}
          recordType={query.type}
          state={query.state}
          search={parseLibrarySearch(query.q)}
          basePath="/testing/workspace-library"
        />
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
