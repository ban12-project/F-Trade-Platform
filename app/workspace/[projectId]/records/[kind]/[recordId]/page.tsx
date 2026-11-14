import type { Metadata } from "next";
import { RecordPage, type RecordPageProps } from "@/components/workspace/record-page";
import { workspaceRecordTitle } from "@/lib/workspace/page-title";

export async function generateMetadata({ params }: RecordPageProps): Promise<Metadata> {
  return { title: workspaceRecordTitle((await params).kind, "record") };
}

export const prefetch = "partial";
export default function Page(props: RecordPageProps) {
  return <RecordPage {...props} mode="record" />;
}
