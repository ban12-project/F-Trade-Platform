import {
  type LibraryPageProps,
  WorkspaceLibraryPage,
} from "@/components/workspace/workspace-library-page";
export const prefetch = "partial";
export default function Page(props: LibraryPageProps) {
  return <WorkspaceLibraryPage collection="content" {...props} />;
}
