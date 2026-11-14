import type { Metadata } from "next";
import { ProjectPage } from "@/components/workspace/project-page";
export const metadata: Metadata = { title: "项目详情" };

export const prefetch = "partial";
export default ProjectPage;
