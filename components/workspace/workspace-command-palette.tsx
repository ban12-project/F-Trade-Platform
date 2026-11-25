"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandItemIcon,
  CommandList,
  CommandSeparator,
} from "@ui-sdk/react/command";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogShortcut,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import {
  BotIcon,
  CheckSquareIcon,
  FileTextIcon,
  FilmIcon,
  FolderOpenIcon,
  MessageSquarePlusIcon,
  PackageIcon,
  PackagePlusIcon,
  RadioIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkspaceDirtyState } from "./dirty-state";
import { type NewWorkIntent, useNewWork } from "./new-work";

export function WorkspaceCommandPalette({ basePath = "/workspace" }: { basePath?: string }) {
  const router = useRouter();
  const { requestNavigation } = useWorkspaceDirtyState();
  const newWork = useNewWork();
  const [open, setOpen] = useState(false);

  function navigateTo(href: string) {
    setOpen(false);
    requestNavigation(() => {
      router.push(href);
    });
  }

  function startWork(intent: NewWorkIntent) {
    setOpen(false);
    newWork?.start(intent);
  }

  const projects = newWork?.projects ?? [];

  function runCommand(value: string) {
    if (value.startsWith("intent:")) {
      startWork(value.slice("intent:".length) as NewWorkIntent);
      return;
    }
    if (value.startsWith("route:")) {
      navigateTo(value.slice("route:".length));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        type="button"
        shortcut="mod+k"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "gap-2 text-muted-foreground",
        )}
      >
        <SearchIcon className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">快速跳转或新建…</span>
        <span className="sm:hidden">命令</span>
        <DialogShortcut className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground sm:inline" />
      </DialogTrigger>
      <DialogBackdrop className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[1px]" />
      <DialogContent className="fixed top-[18%] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <DialogTitle className="text-xs font-medium text-muted-foreground">
            全局命令面板
          </DialogTitle>
          <DialogClose
            type="button"
            aria-label="关闭命令面板"
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" aria-hidden="true" />
          </DialogClose>
        </div>
        <Command onAction={runCommand} className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <CommandInput
              autoFocus
              aria-label="搜索命令、页面或项目"
              placeholder="输入页面、操作或项目名称…"
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
          <CommandEmpty className="px-4 py-8 text-center text-sm text-muted-foreground">
            未找到匹配命令或项目，请换个关键词。
          </CommandEmpty>
          <CommandList className="max-h-80 overflow-y-auto p-1.5">
            <CommandGroup>
              <CommandGroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                快速开始工作
              </CommandGroupLabel>
              <CommandItem
                value="intent:product"
                label="录入新产品（文档导入或手动录入）"
                keywords={["product", "import", "pdf", "csv", "录入", "产品"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <PackagePlusIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>录入新产品（文档导入或手动录入）</span>
              </CommandItem>
              <CommandItem
                value="intent:content"
                label="制作图文推广内容"
                keywords={["content", "post", "制作内容", "文案"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <FileTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>制作图文推广内容</span>
              </CommandItem>
              <CommandItem
                value="intent:video"
                label="制作营销视频"
                keywords={["video", "reel", "视频", "剪辑"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <FilmIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>制作营销视频</span>
              </CommandItem>
              <CommandItem
                value="intent:rfq"
                label="记录客户询盘（RFQ）"
                keywords={["rfq", "lead", "dm", "询盘", "客户"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <MessageSquarePlusIcon
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </CommandItemIcon>
                <span>记录客户询盘（RFQ）</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator className="my-1 h-px bg-border" />
            <CommandGroup>
              <CommandGroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                工作区页面与设置
              </CommandGroupLabel>
              <CommandItem
                value={`route:${basePath}`}
                label="今日任务与入站 DM 分流"
                keywords={["tasks", "inbox", "dm", "今日任务"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <CheckSquareIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>今日任务与入站 DM 分流</span>
              </CommandItem>
              <CommandItem
                value={`route:${basePath}/products`}
                label="产品资料库"
                keywords={["products", "产品资料"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <PackageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>产品资料库</span>
              </CommandItem>
              <CommandItem
                value={`route:${basePath}/content`}
                label="内容与发布"
                keywords={["content", "publish", "内容", "发布"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <FileTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>内容与发布</span>
              </CommandItem>
              <CommandItem
                value={`route:${basePath}/customers`}
                label="客户与询盘"
                keywords={["customers", "leads", "客户", "报价"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <UsersIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>客户与询盘</span>
              </CommandItem>
              <CommandItem
                value={`route:${basePath}/projects`}
                label="项目管理"
                keywords={["projects", "项目管理"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <FolderOpenIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>项目管理</span>
              </CommandItem>
              <CommandItem
                value={`route:${basePath}/settings?section=channels`}
                label="渠道、发布账号与定时同步设置"
                keywords={["channels", "dm", "sync", "渠道", "同步", "收件箱"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <RadioIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>渠道、发布账号与定时同步设置</span>
              </CommandItem>
              <CommandItem
                value={`route:${basePath}/settings?section=agent`}
                label="AI 模型设置"
                keywords={["agent", "model", "ai", "模型"]}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CommandItemIcon>
                  <BotIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </CommandItemIcon>
                <span>AI 模型设置</span>
              </CommandItem>
            </CommandGroup>
            {projects.length ? (
              <>
                <CommandSeparator className="my-1 h-px bg-border" />
                <CommandGroup>
                  <CommandGroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    切换到项目
                  </CommandGroupLabel>
                  {projects.slice(0, 12).map((project) => {
                    const href =
                      project.kind === "sales"
                        ? `${basePath}/customers?project=${project.id}`
                        : `${basePath}/products?project=${project.id}`;
                    const kindLabel = project.kind === "sales" ? "销售项目" : "营销项目";
                    return (
                      <CommandItem
                        key={project.id}
                        value={`route:${href}`}
                        label={`${project.title} · ${kindLabel}`}
                        keywords={[project.title, kindLabel]}
                        className="flex cursor-default items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <CommandItemIcon>
                            <FolderOpenIcon
                              className="size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                          </CommandItemIcon>
                          <span className="truncate">{project.title}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{kindLabel}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
