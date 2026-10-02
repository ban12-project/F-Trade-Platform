"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { changeWorkspaceProjectStatusAction } from "@/lib/actions/workspace";
import { workspaceProjectStatusChangeSchema } from "@/lib/workspace/contracts";

export function ProjectStatusControl({
  projectId,
  status,
}: {
  projectId: string;
  status: "active" | "archived";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const input = workspaceProjectStatusChangeSchema.parse({
              projectId,
              status: status === "active" ? "archived" : "active",
            });
            const result = await changeWorkspaceProjectStatusAction(input);
            setMessage(result.message);
            if (result.status === "success") router.refresh();
          })
        }
      >
        {pending ? "保存中…" : status === "active" ? "归档项目" : "重开项目"}
      </Button>
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
