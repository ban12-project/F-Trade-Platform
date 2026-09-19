"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckSquareIcon, FolderOpenIcon, PlusIcon, SaveIcon, Settings2Icon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { type ReactNode, startTransition, useActionState, useEffect, useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { createWorkspaceProjectAction, type WorkspaceActionState } from "@/lib/actions/workspace";
import { createWorkspaceProjectSchema } from "@/lib/workspace/contracts";
import { workspaceTaskHref } from "@/lib/workspace/navigation";
import type { WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
import { isActionableTask, taskStateLabel } from "@/lib/workspace/task-model";
import { useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";
import { WorkspaceLink } from "./workspace-link";

type Values = z.infer<typeof createWorkspaceProjectSchema>;
type DockPanel = "projects" | "tasks" | "tools" | null;
const initialState: WorkspaceActionState = { status: "idle", message: "" };

function DockPanelContent({
  id,
  title,
  description,
  children,
  open,
  onOpenChange,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mobile = useIsMobile();
  if (mobile)
    return (
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent id={id} className="h-[85dvh]">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1">{children}</div>
          <div className="shrink-0 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <DrawerClose render={<Button variant="outline" className="w-full" />}>
              关闭{title}
            </DrawerClose>
          </div>
        </DrawerContent>
      </Drawer>
    );
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        id={id}
        side="right"
        showOverlay={false}
        className="bottom-24 top-20 h-auto gap-0 rounded-l-2xl border-y bg-popover/95 backdrop-blur-xl sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function WorkspaceActionDock({
  projects,
  tasks,
  settingsPanel,
  activeProjectId: initialActiveProjectId,
  basePath = "/workspace",
  onSave,
  saveDisabled,
  savePending,
}: {
  projects: WorkspaceProjectSummary[];
  tasks: WorkspaceTaskSummary[];
  settingsPanel?: ReactNode;
  activeProjectId?: string;
  basePath?: string;
  onSave?: () => void;
  saveDisabled?: boolean;
  savePending?: boolean;
}) {
  const router = useRouter();
  const params = useParams();
  const id = useId();
  const projectsPanelId = `${id}-projects`;
  const actionableCount = tasks.filter(isActionableTask).length;
  const tasksPanelId = `${id}-tasks`;
  const toolsPanelId = `${id}-tools`;
  const createDialogId = `${id}-create`;
  const titleInputId = `${id}-title`;
  const titleErrorId = `${id}-title-error`;
  const kindLabelId = `${id}-kind-label`;
  const activeProjectId =
    typeof params.projectId === "string" ? params.projectId : initialActiveProjectId;
  const { requestNavigation, discardVersion } = useWorkspaceDirtyState();
  const [panel, setPanel] = useState<DockPanel>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [state, action, pending] = useActionState(createWorkspaceProjectAction, initialState);
  const form = useForm<Values>({
    resolver: zodResolver(createWorkspaceProjectSchema),
    defaultValues: { kind: "marketing", title: "" },
  });
  useWorkspaceDirty("new-project", createOpen && form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success" && state.projectId) {
      form.reset();
      setCreateOpen(false);
      router.push(`${basePath}/${state.projectId}`);
    }
  }, [basePath, form, router, state.projectId, state.status]);
  useEffect(() => {
    if (!discardVersion) return;
    form.reset();
    setCreateOpen(false);
    setPanel(null);
  }, [discardVersion, form]);
  function submit(values: Values) {
    const data = new FormData();
    data.set("kind", values.kind);
    data.set("title", values.title);
    startTransition(() => action(data));
  }
  function changeCreateOpen(open: boolean) {
    if (open) {
      setCreateOpen(true);
      return;
    }
    requestNavigation(() => {
      form.reset();
      setCreateOpen(false);
    });
  }
  return (
    <>
      <nav
        aria-label="工作台操作"
        data-testid="workspace-action-dock"
        className="workspace-dock rounded-2xl border bg-background/90 shadow-lg backdrop-blur-xl"
      >
        <Button
          aria-label="项目"
          aria-haspopup="dialog"
          aria-expanded={panel === "projects"}
          aria-controls={panel === "projects" ? projectsPanelId : undefined}
          className="h-auto min-h-11 min-w-11 flex-col gap-1 px-2 py-2 sm:flex-row sm:py-0"
          variant="ghost"
          onClick={() => setPanel("projects")}
        >
          <FolderOpenIcon data-icon="inline-start" />
          <span aria-hidden="true" className="text-xs sm:text-sm">
            项目
          </span>
        </Button>
        <Button
          aria-label="新建项目"
          aria-haspopup="dialog"
          aria-expanded={createOpen}
          aria-controls={createOpen ? createDialogId : undefined}
          className="h-auto min-h-11 min-w-11 flex-col gap-1 px-2 py-2 sm:flex-row sm:py-0"
          variant="ghost"
          onClick={() => {
            setPanel(null);
            setCreateOpen(true);
          }}
        >
          <PlusIcon data-icon="inline-start" />
          <span aria-hidden="true" className="text-xs sm:text-sm">
            新建项目
          </span>
        </Button>
        <Button
          aria-label={`待办${actionableCount ? `，${actionableCount} 项` : ""}`}
          aria-haspopup="dialog"
          aria-expanded={panel === "tasks"}
          aria-controls={panel === "tasks" ? tasksPanelId : undefined}
          className="h-auto min-h-11 min-w-11 flex-col gap-1 px-2 py-2 sm:flex-row sm:py-0"
          variant="ghost"
          onClick={() => setPanel("tasks")}
        >
          <CheckSquareIcon data-icon="inline-start" />
          <span aria-hidden="true" className="flex items-center gap-1 text-xs sm:text-sm">
            待办
            {actionableCount ? (
              <Badge variant="secondary" className="tabular-nums">
                {actionableCount}
              </Badge>
            ) : null}
          </span>
        </Button>
        {settingsPanel ? (
          <Button
            aria-label="账号与工具"
            aria-haspopup="dialog"
            aria-expanded={panel === "tools"}
            aria-controls={panel === "tools" ? toolsPanelId : undefined}
            className="h-auto min-h-11 min-w-11 flex-col gap-1 px-2 py-2 sm:flex-row sm:py-0"
            variant="ghost"
            onClick={() => setPanel("tools")}
          >
            <Settings2Icon data-icon="inline-start" />
            <span aria-hidden="true" className="text-xs sm:text-sm">
              <span className="sm:hidden">工具</span>
              <span className="hidden sm:inline">账号与工具</span>
            </span>
          </Button>
        ) : null}
        {onSave ? (
          <Button
            className="min-h-11"
            variant="default"
            disabled={saveDisabled || savePending}
            onClick={onSave}
          >
            <SaveIcon data-icon="inline-start" />
            {savePending ? "保存中" : "保存"}
          </Button>
        ) : null}
      </nav>
      <DockPanelContent
        id={projectsPanelId}
        title="项目"
        description="切换项目后直接进入当前业务步骤。"
        open={panel === "projects"}
        onOpenChange={(open) => setPanel(open ? "projects" : null)}
      >
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-2 p-4">
            <WorkspaceLink
              className={buttonVariants({
                variant: !activeProjectId ? "secondary" : "outline",
                className: "justify-start",
              })}
              href={basePath}
              aria-current={!activeProjectId ? "page" : undefined}
              onFollow={() => setPanel(null)}
            >
              工作台
            </WorkspaceLink>
            {projects.map((project) => (
              <WorkspaceLink
                key={project.id}
                className={buttonVariants({
                  variant: project.id === activeProjectId ? "secondary" : "outline",
                  className: "h-auto justify-start py-3 text-left",
                })}
                aria-current={project.id === activeProjectId ? "page" : undefined}
                href={`${basePath}/${project.id}`}
                onFollow={() => setPanel(null)}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-medium">{project.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {project.kind === "marketing" ? "产品营销" : "销售机会"} ·{" "}
                    {project.status === "active" ? "进行中" : "已归档"}
                  </span>
                </span>
              </WorkspaceLink>
            ))}
          </div>
        </ScrollArea>
      </DockPanelContent>
      <DockPanelContent
        id={tasksPanelId}
        title="跨项目待办"
        description="按优先级汇总，打开后直接定位到所属项目步骤和记录。"
        open={panel === "tasks"}
        onOpenChange={(open) => setPanel(open ? "tasks" : null)}
      >
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-2 p-4">
            {tasks.length ? (
              tasks.map((task) => {
                const target = workspaceTaskHref(task, `${basePath}/${task.projectId}`);
                return (
                  <WorkspaceLink
                    key={`${task.projectId}-${task.taskType}-${task.id}`}
                    data-target={target}
                    className={buttonVariants({
                      variant: "outline",
                      className: "h-auto justify-start py-3 text-left",
                    })}
                    href={target}
                    onFollow={() => setPanel(null)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <Badge variant={task.priority === "review" ? "default" : "secondary"}>
                          {task.state
                            ? taskStateLabel(task)
                            : task.priority === "review"
                              ? "审核"
                              : "补全"}
                        </Badge>
                        <span className="truncate font-medium">{task.title}</span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {task.projectTitle} · {task.detail}
                      </span>
                    </span>
                  </WorkspaceLink>
                );
              })
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">当前没有待处理事项。</p>
            )}
          </div>
        </ScrollArea>
      </DockPanelContent>
      {settingsPanel ? (
        <DockPanelContent
          id={toolsPanelId}
          title="工具与账号"
          description="管理团队、模型、渠道和账号边界。"
          open={panel === "tools"}
          onOpenChange={(open) => setPanel(open ? "tools" : null)}
        >
          <ScrollArea className="h-full">
            <div className="p-4">{settingsPanel}</div>
          </ScrollArea>
        </DockPanelContent>
      ) : null}
      <Dialog open={createOpen} onOpenChange={changeCreateOpen}>
        <DialogContent id={createDialogId}>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>创建后立即进入项目的第一项待处理步骤。</DialogDescription>
          </DialogHeader>
          <form
            className="min-h-0 overflow-y-auto"
            noValidate
            aria-busy={pending}
            onSubmit={form.handleSubmit(submit)}
          >
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.title}>
                <FieldLabel htmlFor={titleInputId}>项目名称</FieldLabel>
                <Input
                  id={titleInputId}
                  required
                  placeholder="例如：离合器新品推广"
                  aria-invalid={!!form.formState.errors.title}
                  aria-describedby={form.formState.errors.title ? titleErrorId : undefined}
                  {...form.register("title")}
                />
                <FieldError id={titleErrorId}>{form.formState.errors.title?.message}</FieldError>
              </Field>
              <Field>
                <FieldLabel id={kindLabelId}>项目类型</FieldLabel>
                <Controller
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <ToggleGroup
                      aria-labelledby={kindLabelId}
                      value={[field.value]}
                      onValueChange={(value) => value[0] && field.onChange(value[0])}
                      variant="outline"
                      spacing={2}
                    >
                      <ToggleGroupItem value="marketing">产品营销</ToggleGroupItem>
                      <ToggleGroupItem value="sales">销售机会</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                />
              </Field>
              <Button type="submit" disabled={pending}>
                <PlusIcon data-icon="inline-start" />
                {pending ? "正在创建…" : "创建并进入项目"}
              </Button>
            </FieldGroup>
          </form>
          <p role="status" className="sr-only">
            {pending ? "正在创建项目，请勿重复提交。" : ""}
          </p>
          {state.status === "error" ? (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
