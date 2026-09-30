"use client";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import type { LeadEntry } from "@/lib/sales/closing-store";
import { salesStateLabels } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";

import { RfqForm } from "./rfq-form";
import { RfqReadyForm } from "./rfq-ready-form";

const types = [
  ["clutch_disc", "离合器片"],
  ["clutch_cover", "离合器盖 / 压盘"],
  ["release_bearing", "分离轴承"],
  ["clutch_kit", "离合器套件"],
] as const;
export function RfqDetail({
  projectId,
  entry,
  leads = [],
  children,
}: {
  projectId: string;
  entry: RfqEntry;
  leads?: LeadEntry[];
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {children}
      <Card>
        <CardHeader>
          <CardTitle>客户需求</CardTitle>
          <CardDescription>
            {salesStateLabels[entry.state]} · {entry.formValues.customerName || "客户名称待补充"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            {types.find(([type]) => type === entry.productType)?.[1]} ·{" "}
            {entry.formValues.oeNumber ||
              `${entry.formValues.vehicleBrand} ${entry.formValues.vehicleModel}`.trim() ||
              "产品身份待补充"}
          </p>
          <p className="text-sm">
            数量：{entry.quantity ?? "待补充"} · 目的地：{entry.destination ?? "待补充"}
          </p>
          <Progress aria-label="需求完整度" value={entry.completenessScore}>
            <ProgressLabel>需求完整度</ProgressLabel>
            <ProgressValue>{() => `${entry.completenessScore}%`}</ProgressValue>
          </Progress>
        </CardContent>
      </Card>
      {entry.state === "RFQ_COLLECTING" ? (
        <RfqForm key={entry.id} projectId={projectId} entry={entry} leads={leads} />
      ) : null}
      <RfqReadyForm projectId={projectId} entry={entry} />
    </div>
  );
}
