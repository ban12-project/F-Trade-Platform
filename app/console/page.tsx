import { Suspense } from "react";
import { headers } from "next/headers";
import { ArrowRightIcon, BoxesIcon, FilePenLineIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { auth } from "@/lib/auth";
import { listContentCatalogEntries, type ContentCatalogEntry } from "@/lib/content/store";
import { listProductCatalogEntries, type ProductCatalogEntry } from "@/lib/products";

const numberFormatter = new Intl.NumberFormat("zh-CN");

function statusLabel(state: string) {
  return ({
    PRODUCT_REVIEW_REQUIRED: "产品待审核",
    PRODUCT_REVISION_REQUIRED: "产品待修订",
    CONTENT_REVIEW_REQUIRED: "内容待审核",
    CONTENT_REVISION_REQUIRED: "内容待修订",
  } as Record<string, string>)[state] ?? state;
}

function statusVariant(state: string): "secondary" | "outline" | "destructive" {
  if (state.endsWith("REVISION_REQUIRED")) return "destructive";
  if (state.endsWith("REVIEW_REQUIRED")) return "secondary";
  return "outline";
}

function DashboardStats({ products, contents }: { products: ProductCatalogEntry[]; contents: ContentCatalogEntry[] }) {
  const stats = [
    {
      label: "产品草稿",
      value: products.length,
      description: "已进入目录接收流程",
      icon: BoxesIcon,
    },
    {
      label: "待处理审核",
      value: products.filter((entry) => entry.state === "PRODUCT_REVIEW_REQUIRED").length + contents.filter((entry) => entry.state === "CONTENT_REVIEW_REQUIRED").length,
      description: "需要人工 Gate 01 决定",
      icon: ShieldCheckIcon,
    },
    {
      label: "已核验产品",
      value: products.filter((entry) => entry.state === "PRODUCT_READY").length,
      description: "可作为内容事实来源",
      icon: BoxesIcon,
    },
    {
      label: "内容草稿",
      value: contents.length,
      description: "批准不等于已发布",
      icon: FilePenLineIcon,
    },
  ];

  return (
    <section aria-labelledby="overview-stats-heading">
      <h2 id="overview-stats-heading" className="sr-only">工作台统计</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="gap-4">
              <CardHeader className="flex-row items-center justify-between gap-3 pb-0">
                <CardDescription>{stat.label}</CardDescription>
                <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
                  <Icon />
                </span>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tracking-tight tabular-nums">{numberFormatter.format(stat.value)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function ReviewQueue({ products, contents }: { products: ProductCatalogEntry[]; contents: ContentCatalogEntry[] }) {
  const queue = [
    ...products
      .filter((entry) => entry.state === "PRODUCT_REVIEW_REQUIRED" || entry.state === "PRODUCT_REVISION_REQUIRED")
      .map((entry) => ({ id: entry.id, name: entry.productName, detail: entry.internalSku, state: entry.state, href: entry.state === "PRODUCT_REVISION_REQUIRED" ? `/console/products/${entry.id}/revise` : `/console/products/${entry.id}` })),
    ...contents
      .filter((entry) => entry.state === "CONTENT_REVIEW_REQUIRED" || entry.state === "CONTENT_REVISION_REQUIRED")
      .map((entry) => ({ id: entry.id, name: entry.hook, detail: entry.productName, state: entry.state, href: entry.state === "CONTENT_REVISION_REQUIRED" ? `/console/content/${entry.id}/revise` : `/console/content/${entry.id}` })),
  ].slice(0, 6);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>审核队列</CardTitle>
            <CardDescription>按当前状态优先显示需要人工动作的条目。</CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0">Gate 01</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {queue.length === 0 ? (
          <Empty className="min-h-48 border-0 p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ShieldCheckIcon /></EmptyMedia>
              <EmptyTitle>审核队列为空</EmptyTitle>
              <EmptyDescription>新的产品或内容草稿会在提交后出现在这里。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col divide-y">
            {queue.map((item) => (
              <Link key={`${item.state}-${item.id}`} href={item.href} className="group flex min-w-0 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
                    {item.state.startsWith("PRODUCT") ? <BoxesIcon /> : <FilePenLineIcon />}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium group-hover:underline group-hover:underline-offset-4">{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant={statusVariant(item.state)} className="hidden sm:inline-flex">{statusLabel(item.state)}</Badge>
                  <ArrowRightIcon aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <LinkButton variant="ghost" size="sm" className="px-0" href="/console/products">
          查看产品目录
          <ArrowRightIcon data-icon="inline-end" />
        </LinkButton>
      </CardFooter>
    </Card>
  );
}

function WorkflowGuide() {
  const steps = [
    ["01", "接收资料", "绑定来源与证据引用"],
    ["02", "人工核验", "逐项确认工程事实"],
    ["03", "起草内容", "只引用已核验字段"],
    ["04", "审核发布", "渠道启用后再由人工决策"],
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>受控工作流</CardTitle>
        <CardDescription>平台把 AI 的营销语言能力限制在已经通过证据门禁的范围内。</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map(([number, title, description]) => (
            <li key={number} className="flex gap-3">
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{number}</span>
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs leading-5 text-muted-foreground">{description}</span>
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

async function AuthorizedOverview() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");

  const [products, contents] = await Promise.all([
    listProductCatalogEntries(),
    listContentCatalogEntries(),
  ]);

  return (
    <div className="flex min-h-full flex-col gap-8 p-4 md:p-6 lg:p-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">内部工作台</Badge>
            <Badge variant="outline">MVP · 离合器试点</Badge>
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-balance">把每一次审核都变成可追溯的下一步</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground text-pretty">
              从工厂资料到内容草稿，所有关键字段都留在证据边界内。先处理队列，再推进产品与内容的下一步。
            </p>
          </div>
        </div>
        <LinkButton href="/console/products">
          <PlusIcon data-icon="inline-start" />
          录入产品资料
        </LinkButton>
      </header>

      <DashboardStats products={products} contents={contents} />

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <ReviewQueue products={products} contents={contents} />
        <Card>
          <CardHeader>
            <CardTitle>下一步建议</CardTitle>
            <CardDescription>根据当前数据状态安排工作。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LinkButton variant="outline" className="justify-between" href="/console/products">
              <span className="flex items-center gap-2"><BoxesIcon data-icon="inline-start" />检查产品资料</span>
              <ArrowRightIcon data-icon="inline-end" />
            </LinkButton>
            <LinkButton variant="outline" className="justify-between" href="/console/content">
              <span className="flex items-center gap-2"><FilePenLineIcon data-icon="inline-start" />查看内容草稿</span>
              <ArrowRightIcon data-icon="inline-end" />
            </LinkButton>
          </CardContent>
          <CardFooter className="text-xs leading-5 text-muted-foreground">
            报价、交期与正式发布仍需各自的人工 Gate；这里不会生成承诺。
          </CardFooter>
        </Card>
      </div>

      <WorkflowGuide />

      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>证据优先</AlertTitle>
        <AlertDescription>OE、车型、尺寸、花键、摩擦材料、认证、寿命和安全性能必须来自工厂来源或人工确认，AI 不能补齐缺失事实。</AlertDescription>
      </Alert>
    </div>
  );
}

function OverviewShell() {
  return <div className="p-4 md:p-6 lg:p-8" aria-busy="true" />;
}

export default function ConsoleOverviewPage() {
  return (
    <Suspense fallback={<OverviewShell />}>
      <AuthorizedOverview />
    </Suspense>
  );
}
