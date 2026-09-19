import { ProjectPage, type ProjectPageProps } from "@/components/workspace/project-page";
export const prefetch = "partial";
export default function Page(props: ProjectPageProps) {
  return <ProjectPage {...props} mode="record" />;
}
