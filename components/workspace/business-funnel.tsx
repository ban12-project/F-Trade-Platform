import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { BusinessFunnel } from "@/lib/workspace/business-funnel";
import { WorkspaceLink } from "./workspace-link";

export function BusinessFunnelPanel({ funnel }: { funnel: BusinessFunnel | null }) {
  return (
    <section aria-label="业务漏斗" className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">业务漏斗</h2>
        <p className="text-sm text-muted-foreground">
          当前可见、未归档项目的独立阶段计数，不是同一批客户的转化链，不计算转化率。仅计归属记录，不把跨项目引用拼成转化关系。
        </p>
      </div>
      {!funnel ? (
        <p role="status" className="text-sm text-muted-foreground">
          业务数据暂不可用，请刷新后重试。未将读取失败显示为 0。
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            范围：{funnel.projectCount} 个可见的未归档项目。没有可追溯关联的阶段保持独立。
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {funnel.stages.map((stage) => (
              <Card key={stage.id} size="sm" aria-label={stage.label}>
                <CardHeader>
                  <CardTitle>{stage.label}</CardTitle>
                  <p
                    className="text-3xl font-semibold tabular-nums"
                    data-testid={`funnel-count-${stage.id}`}
                  >
                    {stage.count ?? "暂不可用"}
                  </p>
                  <CardDescription>{stage.definition}</CardDescription>
                </CardHeader>
                <CardContent>
                  {stage.count === null ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      人工确认证据读取失败，未按状态推定数量。
                    </p>
                  ) : stage.records.length || stage.excluded.length ? (
                    <Collapsible>
                      <CollapsibleTrigger className="min-h-11 rounded text-sm underline underline-offset-4 focus-visible:outline-2">
                        查看记录与口径
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {stage.records.length ? (
                          <ul className="space-y-2 pt-2">
                            {stage.records.map((record) => (
                              <li key={record.id}>
                                <WorkspaceLink
                                  className="break-all text-sm underline underline-offset-4"
                                  href={record.href}
                                >
                                  {record.projectTitle} · {record.label}
                                </WorkspaceLink>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">暂无符合口径的记录。</p>
                        )}
                        {stage.excluded.length ? (
                          <div className="mt-3 text-sm">
                            <p className="text-muted-foreground">
                              {stage.excluded.length} 条状态或凭证不完整，未计入：
                            </p>
                            <ul className="space-y-2 pt-2">
                              {stage.excluded.map((record) => (
                                <li key={record.id}>
                                  <WorkspaceLink
                                    className="break-all underline underline-offset-4"
                                    href={record.href}
                                  >
                                    {record.projectTitle} · {record.id.slice(0, 8)}
                                  </WorkspaceLink>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </CollapsibleContent>
                    </Collapsible>
                  ) : (
                    <p className="text-sm text-muted-foreground">暂无符合口径的记录。</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
