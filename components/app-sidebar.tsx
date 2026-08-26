"use client";

import { useEffect } from "react";
import {
  BoxesIcon,
  ClipboardCheckIcon,
  FilePenLineIcon,
  LayoutDashboardIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

const workspaceItems = [
  { href: "/console", label: "总览", icon: LayoutDashboardIcon },
  { href: "/console/products", label: "产品目录", icon: BoxesIcon },
  { href: "/console/content", label: "内容工作台", icon: FilePenLineIcon },
] as const;

const managementItems = [
  { href: "/console/invitations", label: "团队邀请", icon: UserPlusIcon },
] as const;

function isItemActive(pathname: string, href: string) {
  return href === "/console" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: readonly { href: string; label: string; icon: typeof LayoutDashboardIcon }[];
  pathname: string;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={isItemActive(pathname, item.href)}
                  render={<Link href={item.href} />}
                  tooltip={item.label}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/console" />}
              tooltip="F-Trade 工作台"
            >
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
                aria-hidden="true"
              >
                F
              </span>
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="truncate font-semibold">F-Trade</span>
                <span className="truncate text-xs text-sidebar-foreground/60">离合器外贸工作流</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <NavigationGroup label="工作区" items={workspaceItems} pathname={pathname} />
        <NavigationGroup label="管理" items={managementItems} pathname={pathname} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <div className="flex items-start gap-2 px-2 py-2 text-xs text-sidebar-foreground/65 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <ClipboardCheckIcon aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="leading-5 group-data-[collapsible=icon]:hidden">
            所有产品事实与内容发布都必须经过人工 Gate 01。
          </span>
        </div>
        <div className="flex items-center gap-2 px-2 pb-1 text-xs text-sidebar-foreground/50 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="size-1.5 rounded-full bg-sidebar-primary" aria-hidden="true" />
          <span className="group-data-[collapsible=icon]:hidden">管理员空间 · 内部使用</span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
