import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRightIcon, BoxesIcon, FileCheck2Icon, ShieldCheckIcon } from "lucide-react";

export default function HomePage() {
  return (
    <main id="main-content" className="min-h-svh overflow-hidden bg-muted/30">
      <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 rounded-md text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground" aria-hidden="true">F</span>
            F-Trade
          </Link>
          <LinkButton href="/auth" variant="ghost" size="sm">登录工作台</LinkButton>
        </header>

        <section className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.08fr_0.92fr] lg:gap-20 lg:py-20">
          <div className="motion-landing-enter flex flex-col gap-7">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">离合器外贸工作流</Badge>
              <Badge variant="outline">离合器试点版</Badge>
            </div>
            <div className="flex flex-col gap-5">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">核对产品事实，再推进下一步。</h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground text-pretty sm:text-lg">F-Trade 在同一工作流中整理工厂资料、产品字段和内容草稿。先核实每项产品事实，再将其用于获客内容。</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <LinkButton href="/auth" size="lg">进入工作台 <ArrowRightIcon data-icon="inline-end" /></LinkButton>
              <LinkButton href="/workspace" size="lg" variant="outline">打开项目画布</LinkButton>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">仅受邀用户可访问 · 不生成正式报价、交期或未经确认的工程事实</p>
          </div>

          <div className="motion-landing-enter motion-landing-enter-delay relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-primary/5 blur-2xl" aria-hidden="true" />
            <Card className="relative overflow-hidden rounded-2xl shadow-xl">
              <CardHeader className="border-b bg-muted/30">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-base">工作流状态</CardTitle>
                    <p className="text-xs text-muted-foreground">每一步都有明确的人工边界</p>
                  </div>
                  <Badge variant="outline">人工事实审核</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 p-6">
                {[
                  [BoxesIcon, "产品资料", "为每个字段保留来源", "PRODUCT_REVIEW_REQUIRED"],
                  [ShieldCheckIcon, "人工核验", "逐项确认工程事实", "HUMAN GATE"],
                  [FileCheck2Icon, "内容草稿", "只引用已核验字段", "REVIEW REQUIRED"],
                ].map(([Icon, title, description, status]) => {
                  const WorkflowIcon = Icon as typeof BoxesIcon;
                  return (
                    <div key={title as string} className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground" aria-hidden="true"><WorkflowIcon /></span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="text-sm font-medium">{title as string}</p>
                        <p className="truncate text-xs text-muted-foreground">{description as string}</p>
                      </div>
                      <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:inline">{status as string}</span>
                    </div>
                  );
                })}
                <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                  <span className="font-medium text-foreground">核心原则：</span>营销语言可以生成，工程事实必须来自工厂来源或人工确认。
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 F-Trade Platform</span>
          <div className="flex items-center gap-4">
            <Link href="/testing" className="underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看测试页面</Link>
            <span>证据优先 · 人工可控</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
