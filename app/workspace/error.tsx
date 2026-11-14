"use client";

import { PageError } from "@/components/page-error";
import { buttonVariants } from "@/components/ui/button";
import { useWorkspaceDirtyState } from "@/components/workspace/dirty-state";
import { WorkspaceLink } from "@/components/workspace/workspace-link";

export default function RouteError({ retry }: { error: unknown; retry: () => void }) {
  const { requestNavigation } = useWorkspaceDirtyState();
  return (
    <PageError
      retry={() => requestNavigation(retry)}
      returnLink={
        <WorkspaceLink href="/workspace" className={buttonVariants({ variant: "outline" })}>
          返回工作台
        </WorkspaceLink>
      }
    />
  );
}
