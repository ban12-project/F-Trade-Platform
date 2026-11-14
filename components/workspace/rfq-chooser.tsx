"use client";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { productTypeLabel, salesStateLabels } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { WorkspaceLink } from "./workspace-link";

export function RfqChooser({
  projectId,
  entries,
  returnTo,
}: {
  projectId: string;
  entries: RfqEntry[];
  returnTo?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>选择已有客户需求</CardTitle>
        <CardDescription>
          这个客户会话关联多份需求，请选择一份继续。以下为客户提出的采购需求，不代表产品适配已核实。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* biome-ignore lint/a11y/noRedundantRoles: Tailwind resets list-style; preserve list semantics in Safari. */}
        <ul role="list" className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id} className="min-w-0">
              <WorkspaceLink
                href={workspaceRecordHref(projectId, "rfq", entry.id, returnTo)}
                className={buttonVariants({
                  variant: "outline",
                  className:
                    "h-auto w-full flex-col items-start gap-1 whitespace-normal wrap-anywhere py-3 text-left",
                })}
              >
                <span className="font-medium">
                  {entry.formValues.customerName || "客户需求"} ·{" "}
                  {productTypeLabel(entry.productType)}
                </span>
                <span>
                  数量：{entry.quantity ?? "待补充"} · 目的地：{entry.destination || "待补充"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {salesStateLabels[entry.state] ?? "状态待核对"} · 需求 {entry.id.slice(0, 8)}…
                  {entry.id.slice(-8)}
                </span>
              </WorkspaceLink>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
