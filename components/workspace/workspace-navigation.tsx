"use client";
import {
  CheckSquareIcon,
  FileTextIcon,
  FolderOpenIcon,
  PackageIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { workspaceCollection } from "@/lib/workspace/navigation";
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";
import { NewWorkButton } from "./new-work";
import { WorkspaceLink } from "./workspace-link";

export function WorkspaceNavigation({
  projects,
  basePath = "/workspace",
  canManage = false,
}: {
  projects: WorkspaceProjectSummary[];
  basePath?: string;
  canManage?: boolean;
}) {
  const pathname = usePathname();
  const recordKind =
    pathname.match(/\/(?:records|new)\/([^/]+)/)?.[1] ??
    (pathname.endsWith("/video") ? "video" : undefined);
  const { setOpenMobile } = useSidebar();
  const items = [
    { path: "", title: "今日任务", icon: CheckSquareIcon },
    { path: "/products", title: "产品资料", icon: PackageIcon },
    { path: "/content", title: "内容与发布", icon: FileTextIcon },
    { path: "/customers", title: "客户与询盘", icon: UsersIcon },
  ];
  return (
    <aside aria-label="工作区导航">
      <Sidebar>
        <SidebarHeader className="gap-4 p-4">
          <span className="text-lg font-semibold tracking-tight">F-Trade</span>
          <NewWorkButton onOpen={() => setOpenMobile(false)} />
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="主要导航" data-testid="workspace-navigation">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const href = `${basePath}${item.path}`;
                    const active =
                      pathname === href ||
                      (!!recordKind && item.path === `/${workspaceCollection(recordKind)}`);
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          size="lg"
                          isActive={active}
                          render={
                            <WorkspaceLink
                              href={href}
                              aria-current={active ? "page" : undefined}
                              onFollow={() => setOpenMobile(false)}
                            />
                          }
                        >
                          <item.icon />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </nav>
          <SidebarGroup>
            <SidebarGroupLabel>项目与成员</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projects.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      isActive={pathname.startsWith(`${basePath}/${project.id}`)}
                      render={
                        <WorkspaceLink
                          href={`${basePath}/${project.id}`}
                          aria-current={
                            pathname.startsWith(`${basePath}/${project.id}`) ? "page" : undefined
                          }
                          onFollow={() => setOpenMobile(false)}
                        />
                      }
                    >
                      <FolderOpenIcon />
                      <span>{project.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {!projects.length ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    开始第一项工作时创建项目。
                  </p>
                ) : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={
                  <WorkspaceLink
                    href={`${basePath}/settings`}
                    onFollow={() => setOpenMobile(false)}
                  />
                }
              >
                <Settings2Icon />
                <span>{canManage ? "账号与管理" : "账号设置"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </aside>
  );
}
