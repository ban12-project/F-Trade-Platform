import type { Metadata } from "next";
import {
  type LibraryPageProps,
  WorkspaceLibraryPage,
} from "@/components/workspace/workspace-library-page";
export const metadata: Metadata = { title: "客户与询盘" };

export const prefetch = "partial";
export default function Page(props: LibraryPageProps) {
  return <WorkspaceLibraryPage collection="customers" {...props} />;
}
