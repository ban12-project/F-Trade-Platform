"use client";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { salesStateLabels } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { WorkspaceLink } from "./workspace-link";

export function RfqChooser({ projectId, entries }: { projectId: string; entries: RfqEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>客户需求</CardTitle>
        <CardDescription>选择已有需求继续，或记录新的询盘。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {entries.map((entry) => (
          <WorkspaceLink
            key={entry.id}
            href={workspaceRecordHref(projectId, "rfq", entry.id)}
            className={buttonVariants({
              variant: "outline",
              className: "h-auto justify-start whitespace-normal py-3 text-left",
            })}
          >
            {entry.formValues.customerName || "客户需求"} · {entry.quantity ?? "数量待补"} ·{" "}
            {salesStateLabels[entry.state]}
          </WorkspaceLink>
        ))}
      </CardContent>
    </Card>
  );
}
