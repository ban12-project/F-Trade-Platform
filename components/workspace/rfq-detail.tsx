"use client";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { rfqCustomerRequirements } from "@/lib/rfq/customer-requirements";
import type { LeadEntry } from "@/lib/sales/closing-store";
import { salesStateLabels } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";
import { RfqForm } from "./rfq-form";
import { RfqReadyForm } from "./rfq-ready-form";
import { StickyPanel } from "./sticky-panel";

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
    <div className="workspace-columns">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              客户需求
            </CardTitle>
            <CardDescription>{salesStateLabels[entry.state]}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-5">
            <section aria-label="已保存的客户信息" className="flex min-w-0 flex-col gap-3">
              <h3 className="text-sm font-medium">客户信息</h3>
              <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                {[
                  ["客户名称", entry.formValues.customerName],
                  ["公司", entry.formValues.customerCompany],
                  ["客户国家", entry.formValues.customerCountry],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words">{value || "未提供"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section aria-label="已保存的采购需求" className="flex min-w-0 flex-col gap-3">
              <h3 className="text-sm font-medium">采购需求</h3>
              <p className="text-sm text-muted-foreground">
                以下为客户提出的需求；OE、车型与规格仍需对照已核验产品，不能据此认定适配。
              </p>
              <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                {[
                  ["产品类型", types.find(([type]) => type === entry.productType)?.[1]],
                  ["OE / OEM 编号", entry.formValues.oeNumber],
                  ["车辆品牌", entry.formValues.vehicleBrand],
                  ["车型", entry.formValues.vehicleModel],
                  [
                    "数量",
                    entry.quantity === null
                      ? undefined
                      : new Intl.NumberFormat("zh-CN").format(entry.quantity),
                  ],
                  ["目的地国家或港口", entry.destination],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words">{value || "未提供"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <Progress aria-label="需求完整度" value={entry.completenessScore}>
              <ProgressLabel>需求完整度</ProgressLabel>
              <ProgressValue>{() => `${entry.completenessScore}%`}</ProgressValue>
            </Progress>
            <p className="text-sm text-muted-foreground">
              完整度仅表示需求收集情况，不代表产品事实已核实或报价已批准。
            </p>
          </CardContent>
        </Card>
        {rfqCustomerRequirements.some(({ field }) => entry.formValues[field]) ? (
          <Card>
            <CardHeader>
              <CardTitle>客户补充需求</CardTitle>
              <CardDescription>客户提出的要求，尚需核实；期望交付不代表工厂承诺。</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                {rfqCustomerRequirements.map(({ field, label }) =>
                  entry.formValues[field] ? (
                    <div key={field} className="grid gap-1">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="whitespace-pre-wrap break-words">{entry.formValues[field]}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </CardContent>
          </Card>
        ) : null}
        {entry.state === "RFQ_COLLECTING" ? (
          <RfqForm key={entry.id} projectId={projectId} entry={entry} leads={leads} />
        ) : null}
        <RfqReadyForm projectId={projectId} entry={entry} />
      </div>
      <StickyPanel>
        <aside aria-label="关联记录" className="workspace-support">
          {children}
        </aside>
      </StickyPanel>
    </div>
  );
}
