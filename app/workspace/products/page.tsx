import type { Metadata } from "next";
import {
  type LibraryPageProps,
  WorkspaceLibraryPage,
} from "@/components/workspace/workspace-library-page";
export const metadata: Metadata = { title: "产品资料" };

export const prefetch = "partial";
export default function Page(props: LibraryPageProps) {
  return <WorkspaceLibraryPage collection="products" {...props} />;
}
