"use client";

import { Suspense } from "react";
import { ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

function getBreadcrumb(pathname: string) {
  if (pathname === "/console") {
    return { section: "工作台", current: "总览", href: "/console" };
  }
  if (pathname.startsWith("/console/products")) {
    if (pathname.endsWith("/revise")) {
      return { section: "产品目录", current: "修订产品草稿", href: "/console/products" };
    }
    if (pathname !== "/console/products") {
      return { section: "产品目录", current: "Gate 01 审核", href: "/console/products" };
    }
    return { section: "工作区", current: "产品目录", href: "/console/products" };
  }
  if (pathname.startsWith("/console/content")) {
    if (pathname.endsWith("/revise")) {
      return { section: "内容工作台", current: "修订内容草稿", href: "/console/content" };
    }
    if (pathname !== "/console/content") {
      return { section: "内容工作台", current: "Gate 01 审核", href: "/console/content" };
    }
    return { section: "工作区", current: "内容工作台", href: "/console/content" };
  }
  if (pathname.startsWith("/console/product-agent")) {
    return { section: "工作区", current: "Product Agent", href: "/console/product-agent" };
  }
  if (pathname.startsWith("/console/sales")) {
    return { section: "工作区", current: "询盘与报价", href: "/console/sales" };
  }
  if (pathname.startsWith("/console/invitations")) {
    return { section: "管理", current: "团队邀请", href: "/console/invitations" };
  }
  if (pathname.startsWith("/console/agent-settings")) {
    return { section: "管理", current: "Agent 配置", href: "/console/agent-settings" };
  }
  if (pathname.startsWith("/console/video/settings")) {
    return { section: "管理", current: "视频模型配置", href: "/console/video/settings" };
  }
  if (pathname.startsWith("/console/security")) {
    return { section: "账号", current: "安全与 Passkey", href: "/console/security" };
  }
  return { section: "工作台", current: "总览", href: "/console" };
}

function ConsoleHeader() {
  const pathname = usePathname();
  const breadcrumb = getBreadcrumb(pathname);

  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger aria-label="展开或收起侧栏" />
        <Separator orientation="vertical" className="hidden h-5 sm:block" />
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem className="hidden sm:inline-flex">
              <BreadcrumbLink render={<Link href={breadcrumb.href} />}>
                {breadcrumb.section}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:inline-flex" />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{breadcrumb.current}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <Badge variant="outline" className="hidden shrink-0 items-center gap-1.5 sm:inline-flex">
        <ShieldCheckIcon aria-hidden="true" />
        人工审核边界
      </Badge>
    </header>
  );
}

function ConsoleHeaderFallback() {
  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-6">
      <SidebarTrigger aria-label="展开或收起侧栏" />
      <Separator orientation="vertical" className="hidden h-5 sm:block" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbPage>工作台</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Suspense fallback={null}>
        <AppSidebar />
      </Suspense>
      <SidebarInset id="main-content">
        <Suspense fallback={<ConsoleHeaderFallback />}>
          <ConsoleHeader />
        </Suspense>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
