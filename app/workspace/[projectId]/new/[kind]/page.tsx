import { RecordPage, type RecordPageProps } from "@/components/workspace/record-page";
export const prefetch = "partial";
export default function Page(props: RecordPageProps) {
  return <RecordPage {...props} mode="create" />;
}
