import type { Metadata } from "next";
import { PageUnavailable } from "@/components/page-unavailable";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import { WorkspaceLink } from "@/components/workspace/workspace-link";

export const metadata: Metadata = { title: { absolute: "无法打开此项目 · F-Trade" } };

export default function ProjectNotFound() {
  return (
    <WorkspaceDirtyProvider>
      <PageUnavailable
        title="无法打开此项目"
        description="该项目不可用，或你没有查看权限。"
        returnLink={
          <WorkspaceLink href="/workspace" className={buttonVariants({ variant: "outline" })}>
            返回工作台
          </WorkspaceLink>
        }
      />
    </WorkspaceDirtyProvider>
  );
}
