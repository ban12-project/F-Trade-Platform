import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { runSyntheticDemo } from "@/scripts/run-synthetic-demo";

const labels = { product: "产品事实", content: "内容", video: "视频", rfq: "RFQ", quotation: "报价", lead: "有效商机", delivery: "交期确认" } as const;

async function BusinessClosureContent() {
  await connection();
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  const report = await runSyntheticDemo();
  return <main className="mx-auto min-h-screen max-w-5xl p-6"><Card><CardHeader><div className="flex flex-wrap gap-2"><Badge>纯合成数据</Badge><Badge variant="outline">人工 Gate 闭环</Badge></div><h1 className="font-heading text-xl font-semibold">业务闭环验收</h1><CardDescription>此页面在服务端执行与仓库校验相同的合成契约，不连接真实客户、工厂或渠道。</CardDescription></CardHeader><CardContent className="flex flex-col gap-6"><ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(report.finalStates).map(([key, state], index) => <li key={key} className="rounded-xl border p-4"><span className="text-xs text-muted-foreground">步骤 {index + 1}</span><p className="font-medium">{labels[key as keyof typeof labels]}</p><Badge variant="secondary">{state}</Badge></li>)}</ol><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-muted p-4"><p className="text-sm font-medium">人工审批</p><p className="text-sm text-muted-foreground">Gate 01、Gate 02、Gate 03</p></div><div className="rounded-xl bg-muted p-4"><p className="text-sm font-medium">受控发布</p><p className="text-sm text-muted-foreground">签名回执 · {report.publicationTransport.jobStatus}</p></div><div className="rounded-xl bg-muted p-4"><p className="text-sm font-medium">人工跟进</p><p className="text-sm text-muted-foreground">发送窗口已重新校验</p></div></div><p aria-live="polite" className="text-sm font-medium">验收终点：OPPORTUNITY</p></CardContent></Card></main>;
}

export default function BusinessClosureTestingPage() {
  return <Suspense fallback={<main className="p-6">正在执行合成闭环验收…</main>}><BusinessClosureContent /></Suspense>;
}
