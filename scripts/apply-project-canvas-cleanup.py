#!/usr/bin/env python3
from __future__ import annotations

import re
import shutil
from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f"{label}: expected exactly one literal match, found {text.count(old)}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return updated


def remove(path: str) -> None:
    target = ROOT / path
    if not target.exists():
        raise RuntimeError(f"expected retired path to exist: {path}")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()


write(
    "lib/workspace/contracts.ts",
    dedent(
        '''
        import { z } from "zod";

        export const workspaceProjectKindSchema = z.enum(["marketing", "sales"]);
        export const workspaceProjectStatusSchema = z.enum(["active", "archived"]);

        export const createWorkspaceProjectSchema = z.object({
          kind: workspaceProjectKindSchema,
          title: z.string().trim().min(1, "请输入项目名称。").max(120, "项目名称不能超过 120 个字符。"),
        }).strict();
        '''
    ),
)

write(
    "lib/actions/workspace.ts",
    dedent(
        '''
        "use server";

        import { revalidatePath } from "next/cache";
        import { headers } from "next/headers";
        import { z } from "zod";

        import { auth } from "@/lib/auth";
        import { hasPermission } from "@/lib/authz";
        import { createWorkspaceProjectSchema } from "@/lib/workspace/contracts";
        import { createWorkspaceProject, linkReadyProductToSalesProject } from "@/lib/workspace/store";
        import { removeWorkspaceProjectMember, upsertWorkspaceProjectMember, workspaceMemberFormSchema, workspaceMemberRemovalSchema } from "@/lib/workspace/access";

        export type WorkspaceActionState = { status: "idle" | "success" | "error"; message: string; projectId?: string };

        async function requireWorkspaceUser() {
          const session = await auth.api.getSession({ headers: await headers() });
          if (!session || !hasPermission(session.user.role, "workspace:view")) throw new Error("无权访问项目工作区。");
          return session;
        }

        export async function createWorkspaceProjectAction(_previous: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
          try {
            const session = await requireWorkspaceUser();
            const parsed = createWorkspaceProjectSchema.safeParse(Object.fromEntries(formData));
            if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "项目资料无效。" };
            const project = await createWorkspaceProject(parsed.data, session.user.id);
            revalidatePath("/workspace");
            return { status: "success", message: "项目已创建。", projectId: project.id };
          } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法创建项目。" }; }
        }

        export async function linkReadyProductToSalesProjectAction(projectIdInput: string, productIdInput: string): Promise<WorkspaceActionState> {
          try {
            const session = await auth.api.getSession({ headers: await headers() });
            if (!session || !hasPermission(session.user.role, "sales:write")) throw new Error("无权为销售项目引用产品。");
            const projectId = z.uuid("项目标识无效。").parse(projectIdInput);
            const productId = z.uuid("产品记录标识无效。").parse(productIdInput);
            await linkReadyProductToSalesProject(projectId, productId, session.user.id);
            revalidatePath(`/workspace/${projectId}`);
            return { status: "success", message: "已引用 Product Ready，不会复制或改写产品事实。", projectId };
          } catch (error) {
            return { status: "error", message: error instanceof Error ? error.message : "无法引用产品。" };
          }
        }

        export async function upsertWorkspaceProjectMemberAction(_previous: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
          try {
            const session = await requireWorkspaceUser();
            const parsed = workspaceMemberFormSchema.safeParse(Object.fromEntries(formData));
            if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "成员资料无效。" };
            await upsertWorkspaceProjectMember(parsed.data, session.user.id);
            revalidatePath(`/workspace/${parsed.data.projectId}`);
            return { status: "success", message: "项目成员角色已保存。", projectId: parsed.data.projectId };
          } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法保存项目成员。" }; }
        }

        export async function removeWorkspaceProjectMemberAction(_previous: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
          try {
            const session = await requireWorkspaceUser();
            const parsed = workspaceMemberRemovalSchema.safeParse(Object.fromEntries(formData));
            if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "成员资料无效。" };
            await removeWorkspaceProjectMember(parsed.data, session.user.id);
            revalidatePath(`/workspace/${parsed.data.projectId}`);
            return { status: "success", message: "项目成员已移除。", projectId: parsed.data.projectId };
          } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法移除项目成员。" }; }
        }
        '''
    ),
)

store = read("lib/workspace/store.ts")
store = replace_once(
    store,
    'import { aggregateRecord, approval, auditEvent, socialPublication, workspaceCanvasDocument, workspaceProject, workspaceProjectItem, workspaceProjectMember } from "@/lib/db/schema";',
    'import { aggregateRecord, approval, auditEvent, socialPublication, workspaceProject, workspaceProjectItem, workspaceProjectMember } from "@/lib/db/schema";',
    "workspace store database imports",
)
store = replace_once(
    store,
    'import { createWorkspaceProjectSchema, createWorkspaceTemplate, normalizeLegacyWorkspaceTemplate, saveWorkspaceCanvasSchema, workspaceCanvasDocumentSchema, type WorkspaceCanvasDocument } from "./contracts";',
    'import { createWorkspaceProjectSchema } from "./contracts";',
    "workspace store contract imports",
)
store = sub_once(
    store,
    r'export class WorkspaceCanvasRevisionConflictError extends Error \{[\s\S]*?\n\}\n\n',
    '',
    "workspace revision conflict class",
)
store = replace_once(
    store,
    'export type WorkspaceProjectDetail = WorkspaceProjectSummary & { document: WorkspaceCanvasDocument; revision: number };\n',
    '',
    "workspace project detail type",
)
store = sub_once(
    store,
    r'export async function createWorkspaceProject\([\s\S]*?(?=export async function listWorkspaceProjectAggregateIds)',
    dedent(
        '''
        export async function createWorkspaceProject(input: unknown, actorId: string, database: Database = getDatabase()): Promise<WorkspaceProjectSummary> {
          const value = createWorkspaceProjectSchema.parse(input);
          const id = randomUUID(); const now = new Date();
          await database.transaction(async (tx) => {
            await tx.insert(workspaceProject).values({ id, title: value.title, kind: value.kind, createdById: actorId });
            await tx.insert(workspaceProjectMember).values({ id: randomUUID(), projectId: id, userId: actorId, role: "owner", createdById: actorId });
            await tx.insert(auditEvent).values({ id: randomUUID(), action: "workspace_project.created", actorType: "human", actorId, subjectType: "workspace_project", subjectId: id, metadata: { kind: value.kind }, occurredAt: now });
          });
          return { id, title: value.title, kind: value.kind, status: "active", updatedAt: now };
        }

        export async function getWorkspaceProject(projectId: string, actorId: string, database: Database = getDatabase()): Promise<WorkspaceProjectSummary | null> {
          await assertWorkspaceProjectAccess(projectId, actorId, "view", database);
          const [row] = await database.select({ id: workspaceProject.id, title: workspaceProject.title, kind: workspaceProject.kind, status: workspaceProject.status, updatedAt: workspaceProject.updatedAt })
            .from(workspaceProject).where(eq(workspaceProject.id, projectId));
          return row ?? null;
        }

        '''
    ),
    "workspace project create/get/save block",
)
write("lib/workspace/store.ts", store)

inbound = read("lib/social/inbound-routing-store.ts")
inbound = replace_once(
    inbound,
    'import { aggregateRecord, auditEvent, socialConversation, workspaceCanvasDocument, workspaceProject, workspaceProjectItem, workspaceProjectMember } from "@/lib/db/schema";',
    'import { aggregateRecord, auditEvent, socialConversation, workspaceProject, workspaceProjectItem, workspaceProjectMember } from "@/lib/db/schema";',
    "inbound store database imports",
)
inbound = replace_once(inbound, 'import { createWorkspaceTemplate } from "@/lib/workspace/contracts";\n', '', "inbound template import")
inbound = replace_once(
    inbound,
    '      await tx.insert(workspaceCanvasDocument).values({ id: randomUUID(), projectId, document: createWorkspaceTemplate("sales"), revision: 1 });\n',
    '',
    "inbound canvas insert",
)
write("lib/social/inbound-routing-store.ts", inbound)

schema = read("lib/db/schema.ts")
schema = sub_once(
    schema,
    r'\n/\*\* Per-project visual composition with optimistic revision control\. \*/\nexport const workspaceCanvasDocument = pgTable\([\s\S]*?\n\);\n\n(?=/\*\*\n \* A narrowly scoped receipt)',
    '\n',
    "workspace canvas table",
)
write("lib/db/schema.ts", schema)

project_page = read("app/workspace/[projectId]/page.tsx")
project_page = replace_once(project_page, 'import { ProjectCanvas } from "@/components/workspace/project-canvas";\n', '', "project canvas import")
project_page = replace_once(project_page, 'type ProjectQuery = { panel?: string; item?: string; view?: string };', 'type ProjectQuery = { panel?: string; item?: string };', "project query")
project_page = sub_once(project_page, r'\n    if \(query\.view === "flow"\) return <ProjectCanvas[^\n]+;', '', "marketing flow branch")
project_page = sub_once(project_page, r'\n  if \(query\.view === "flow"\) return <ProjectCanvas[^\n]+;', '', "sales flow branch")
project_page = replace_once(
    project_page,
    '    rfq: <RfqPanel projectId={projectId} entries={rfqs} selectedId={selectedId} leads={leads} />,\n    product: <ProductReferencePanel projectId={projectId} available={availableProducts} linked={linkedProducts} />,',
    '    rfq: <div className="flex flex-col gap-6"><RfqPanel projectId={projectId} entries={rfqs} selectedId={selectedId} leads={leads} /><ProductReferencePanel projectId={projectId} available={availableProducts} linked={linkedProducts} /></div>,',
    "sales RFQ and product reference composition",
)
write("app/workspace/[projectId]/page.tsx", project_page)

old_loading = read("components/workspace/workspace-canvas-skeleton.tsx")
old_loading = old_loading.replace('// Migration marker retained while the repository validator still audits the retired projectNodePlaceholders contract.\n', '')
old_loading = old_loading.replace('WorkspaceCanvasSkeleton', 'WorkspaceLoadingSkeleton')
write("components/workspace/workspace-loading-skeleton.tsx", old_loading)
remove("components/workspace/workspace-canvas-skeleton.tsx")
for path in ("app/workspace/page.tsx", "app/workspace/[projectId]/page.tsx", "app/workspace/[projectId]/video/page.tsx"):
    source = read(path)
    source = source.replace('workspace-canvas-skeleton', 'workspace-loading-skeleton').replace('WorkspaceCanvasSkeleton', 'WorkspaceLoadingSkeleton')
    write(path, source)

write(
    "components/workspace/project-workspace.tsx",
    dedent(
        '''
        "use client";

        import type { MouseEvent, ReactNode } from "react";
        import Link from "next/link";
        import { useRouter } from "next/navigation";
        import { ArrowLeftIcon, ArrowRightIcon, FilmIcon } from "lucide-react";

        import { Badge } from "@/components/ui/badge";
        import { LinkButton } from "@/components/ui/button";
        import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
        import { ScrollArea } from "@/components/ui/scroll-area";
        import { workspaceTaskHref } from "@/lib/workspace/navigation";
        import type { WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
        import { WorkspaceActionDock } from "./workspace-action-dock";
        import { WorkspaceDirtyProvider, useWorkspaceDirtyState } from "./dirty-state";

        export type ProjectStage = { id: string; panelKind: string; label: string; description: string };

        function shouldUseNativeNavigation(event: MouseEvent<HTMLElement>) {
          return event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        }

        function GuardedLink({ href, children, className, current = false }: { href: string; children: ReactNode; className: string; current?: boolean }) {
          const router = useRouter();
          const { requestNavigation } = useWorkspaceDirtyState();
          function navigate(event: MouseEvent<HTMLAnchorElement>) {
            if (shouldUseNativeNavigation(event)) return;
            event.preventDefault();
            requestNavigation(() => router.push(href));
          }
          return <Link href={href} onClick={navigate} aria-current={current ? "step" : undefined} className={className}>{children}</Link>;
        }

        export function VideoStageEntry({ projectId, count, pendingReview }: { projectId: string; count: number; pendingReview: number }) {
          return <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>视频制作</CardTitle><CardDescription>选择素材、生成 AI 剪辑初稿、预览、修改并提交成片审核。</CardDescription></div><FilmIcon className="size-5 text-muted-foreground" /></div></CardHeader><CardContent className="space-y-4"><div className="flex gap-2"><Badge variant="outline">{count} 个版本</Badge>{pendingReview ? <Badge>{pendingReview} 个待审核</Badge> : null}</div><LinkButton href={`/workspace/${projectId}/video`} className="w-full">进入视频编辑器<ArrowRightIcon data-icon="inline-end" /></LinkButton></CardContent></Card>;
        }

        type ProjectWorkspaceProps = { project: WorkspaceProjectSummary; projects: WorkspaceProjectSummary[]; tasks: WorkspaceTaskSummary[]; settingsPanel?: ReactNode; membersPanel?: ReactNode; stages: ProjectStage[]; activeStage: string; panel: ReactNode; basePath?: string };

        function ProjectWorkspaceInner({ project, projects, tasks, settingsPanel, membersPanel, stages, activeStage, panel, basePath = `/workspace/${project.id}` }: ProjectWorkspaceProps) {
          const router = useRouter();
          const { requestNavigation } = useWorkspaceDirtyState();
          const projectTasks = tasks.filter((task) => task.projectId === project.id);
          const stage = stages.find((item) => item.id === activeStage) ?? stages[0]!;
          const stageTasks = projectTasks.filter((task) => task.nodeKind === stage.panelKind && (stage.id === "opportunity" ? task.taskType === "opportunity" : stage.id === "follow-up" ? task.taskType === "follow_up" : true));
          function returnToWorkspace(event: MouseEvent<HTMLElement>) {
            if (shouldUseNativeNavigation(event)) return;
            event.preventDefault();
            requestNavigation(() => router.push("/workspace"));
          }
          return <main id="main-content" className="min-h-screen bg-muted/30 pb-24">
            <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl"><div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><LinkButton href="/workspace" onClick={returnToWorkspace} size="icon" variant="ghost" aria-label="返回工作台"><ArrowLeftIcon /></LinkButton><div className="min-w-0"><h1 className="truncate text-lg font-semibold tracking-tight">{project.title}</h1><div className="mt-1 flex flex-wrap gap-2"><Badge variant="secondary">{project.kind === "marketing" ? "营销项目" : "销售项目"}</Badge><Badge variant="outline">{project.status === "active" ? "进行中" : "已归档"}</Badge><Badge variant="outline">关键动作需人工确认</Badge></div></div></div>{membersPanel ? <div className="flex items-center gap-2">{membersPanel}</div> : null}</div></header>
            <div className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6">
              <nav aria-label="项目阶段" className="overflow-x-auto pb-2"><ol className="flex min-w-max items-stretch gap-1">{stages.map((item, index) => { const href = `${basePath}?panel=${item.id}`; return <li key={item.id} className="flex items-center"><GuardedLink href={href} current={item.id === activeStage} className={`flex min-h-14 w-40 flex-col justify-center rounded-xl border px-3 outline-none transition-[background-color,border-color,transform] duration-[120ms] active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50 ${item.id === activeStage ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}><span className="text-xs opacity-75">步骤 {index + 1}</span><span className="text-sm font-medium">{item.label}</span></GuardedLink>{index < stages.length - 1 ? <ArrowRightIcon className="mx-1 size-4 text-muted-foreground" aria-hidden="true" /> : null}</li>; })}</ol></nav>
              <section aria-label="当前阶段" className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,34rem)]">
                <div className="min-w-0 space-y-5"><Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardDescription>当前步骤</CardDescription><CardTitle role="heading" aria-level={2} className="mt-1">{stage.label}</CardTitle><p className="mt-2 text-sm text-muted-foreground">{stage.description}</p></div><Badge>{stageTasks.length ? `${stageTasks.length} 项待处理` : "当前无待办"}</Badge></div></CardHeader></Card><Card><CardHeader><CardTitle role="heading" aria-level={2}>待处理事项</CardTitle><CardDescription>先处理这里的下一动作；也可以在右侧新建或查看本步骤的业务记录。</CardDescription></CardHeader><CardContent>{stageTasks.length ? <div className="divide-y">{stageTasks.map((task) => <GuardedLink key={`${task.taskType}-${task.id}`} href={workspaceTaskHref(task, basePath)} className="group flex min-h-16 items-center gap-3 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{task.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{task.detail}</p></div><Badge variant={task.priority === "review" ? "default" : "secondary"}>{task.actionLabel ?? "打开"}</Badge><ArrowRightIcon className="size-4 text-muted-foreground transition-transform duration-[120ms] group-hover:translate-x-0.5" /></GuardedLink>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">本步骤暂无待处理事项，可在右侧创建或查看业务记录。</p>}</CardContent></Card></div>
                <aside aria-label={`${stage.label}详情与审批`} className="min-w-0"><Card className="overflow-hidden"><CardHeader className="border-b"><CardTitle role="heading" aria-level={2}>{stage.label}</CardTitle><CardDescription>批准、发送、发布和业务认定都需要明确的人工操作。</CardDescription></CardHeader><CardContent className="p-0"><ScrollArea className="h-[calc(100vh-17rem)] min-h-[32rem]"><div className="p-4 sm:p-5">{panel}</div></ScrollArea></CardContent></Card></aside>
              </section>
            </div>
            <WorkspaceActionDock projects={projects} tasks={tasks} settingsPanel={settingsPanel} activeProjectId={project.id} />
          </main>;
        }

        export function ProjectWorkspace(props: ProjectWorkspaceProps) {
          return <WorkspaceDirtyProvider><ProjectWorkspaceInner {...props} /></WorkspaceDirtyProvider>;
        }
        '''
    ),
)

write(
    "components/workspace/video-workspace.tsx",
    dedent(
        '''
        "use client";

        import { useState, type MouseEvent } from "react";
        import { useRouter } from "next/navigation";
        import { ArrowLeftIcon, FilmIcon } from "lucide-react";

        import { Badge } from "@/components/ui/badge";
        import { LinkButton } from "@/components/ui/button";
        import type { MarketingVideoCopyCandidate, MarketingVideoEditorEntry, ReadyVideoProductSource } from "@/lib/video/store";
        import { MarketingVideoPanel } from "./marketing-video-panel";
        import { WorkspaceDirtyProvider, useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";

        function VideoWorkspaceInner({ projectId, projectTitle, products, entries, copyCandidates, canReview, selectedId }: { projectId: string; projectTitle: string; products: ReadyVideoProductSource[]; entries: MarketingVideoEditorEntry[]; copyCandidates: MarketingVideoCopyCandidate[]; canReview: boolean; selectedId?: string }) {
          const router = useRouter();
          const { requestNavigation } = useWorkspaceDirtyState();
          const [dirty, setDirty] = useState(false);
          useWorkspaceDirty("video-editor", dirty);
          function returnToProject(event: MouseEvent<HTMLElement>) {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            requestNavigation(() => router.push(`/workspace/${projectId}?panel=video`));
          }
          return <main id="main-content" className="min-h-screen bg-muted/30">
            <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><LinkButton href={`/workspace/${projectId}?panel=video`} onClick={returnToProject} size="icon" variant="ghost" aria-label="返回营销视频步骤"><ArrowLeftIcon /></LinkButton><div className="min-w-0"><h1 className="truncate text-lg font-semibold tracking-tight">视频编辑器</h1><p className="truncate text-xs text-muted-foreground">{projectTitle}</p></div></div><div className="flex gap-2"><Badge variant="secondary"><FilmIcon data-icon="inline-start" />独立编辑器</Badge>{dirty ? <Badge variant="outline">有未保存修改</Badge> : <Badge variant="outline">已同步</Badge>}</div></div></header>
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6"><div className="mb-5"><h2 className="text-xl font-semibold tracking-tight">素材、预览与时间线</h2><p className="mt-1 text-sm text-muted-foreground">在一个连续编辑上下文中管理剪辑版本、私有预览、提审与成片决定。</p></div><MarketingVideoPanel projectId={projectId} products={products} entries={entries} copyCandidates={copyCandidates} canReview={canReview} selectedId={selectedId} onDirtyChange={setDirty} /></div>
          </main>;
        }

        export function VideoWorkspace(props: Parameters<typeof VideoWorkspaceInner>[0]) { return <WorkspaceDirtyProvider><VideoWorkspaceInner {...props} /></WorkspaceDirtyProvider>; }
        '''
    ),
)

dirty_state = read("components/workspace/dirty-state.tsx")
dirty_state = replace_once(dirty_state, "当前画布或面板还有未保存内容。继续后这些修改无法恢复。", "当前页面还有未保存内容。继续后这些修改无法恢复。", "dirty-state description")
write("components/workspace/dirty-state.tsx", dirty_state)

css = read("app/globals.css")
css = sub_once(
    css,
    r'\n/\* React Flow may render[\s\S]*?(?=@media \(pointer: coarse\))',
    '\n',
    "React Flow CSS",
)
css = replace_once(
    css,
    '  [data-slot="drawer-popup"],\n  .react-flow__controls {',
    '  [data-slot="drawer-popup"] {',
    "high-contrast flow selector",
)
write("app/globals.css", css)

old_fixture = read("app/testing/project-canvas/page.tsx")
prefix = old_fixture.split("async function ProjectCanvasFixture", 1)[0]
prefix = replace_once(prefix, 'import { ProjectCanvas } from "@/components/workspace/project-canvas";', 'import { ProjectWorkspace, VideoStageEntry, type ProjectStage } from "@/components/workspace/project-workspace";', "project workflow fixture import")
prefix = replace_once(prefix, 'import type { WorkspaceProjectDetail, WorkspaceProjectSummary } from "@/lib/workspace/store";', 'import type { WorkspaceProjectSummary } from "@/lib/workspace/store";', "project workflow fixture type import")
prefix = prefix.replace('import { createWorkspaceTemplate } from "@/lib/workspace/contracts";\n', '')
prefix = prefix.replace('const syntheticMarketingProject: WorkspaceProjectDetail = {', 'const syntheticMarketingProject: WorkspaceProjectSummary = {')
prefix = prefix.replace('  revision: 1,\n  document: createWorkspaceTemplate("marketing"),\n', '')
prefix = prefix.replace('const syntheticSalesProject: WorkspaceProjectDetail = {', 'const syntheticSalesProject: WorkspaceProjectSummary = {')
prefix = prefix.replace('  document: createWorkspaceTemplate("sales"),\n', '')
prefix = sub_once(prefix, r'const syntheticProjects: WorkspaceProjectSummary\[\] = \[[^\n]+;', 'const syntheticProjects: WorkspaceProjectSummary[] = [syntheticMarketingProject, syntheticSalesProject];', "project workflow project list")
fixture_tail = dedent(
    '''
    const marketingStages: ProjectStage[] = [
      { id: "product", panelKind: "product", label: "产品资料", description: "导入资料，补全字段并完成产品事实核验。" },
      { id: "content", panelKind: "content", label: "营销内容", description: "基于已核验产品事实生成、修改并审核营销内容。" },
      { id: "video", panelKind: "video", label: "营销视频", description: "选择授权素材，在独立编辑器生成剪辑初稿、预览并提审。" },
      { id: "publication", panelKind: "publication", label: "发布", description: "人工确认渠道、账户与载荷，提交后等待平台回执。" },
    ];
    const salesStages: ProjectStage[] = [
      { id: "inbound", panelKind: "lead", label: "客户线索", description: "查看已关联到当前项目的询盘、消息和跟进上下文。" },
      { id: "rfq", panelKind: "rfq", label: "需求确认", description: "补齐产品身份、数量、目的地、证据与产品引用。" },
      { id: "quotation", panelKind: "quotation", label: "报价", description: "人工录入价格与商业条款，并完成报价确认。" },
      { id: "follow-up", panelKind: "lead", label: "跟进", description: "人工编辑并发送回复，安排下一次跟进。" },
      { id: "delivery", panelKind: "delivery", label: "交期", description: "客户询问交期时发起并完成人工确认。" },
      { id: "opportunity", panelKind: "lead", label: "商机", description: "达到条件后，仍由业务人员显式确认有效商机。" },
    ];

    async function ProjectWorkflowFixture({ searchParams }: { searchParams: Promise<{ state?: string; kind?: string; panel?: string }> }) {
      const { state, kind, panel } = await searchParams;
      if (kind === "sales") {
        const panels = {
          rfq: <div className="flex flex-col gap-6"><RfqPanel projectId={syntheticSalesProject.id} entries={[]} leads={[syntheticLead]} /><ProductReferencePanel projectId={syntheticSalesProject.id} available={[syntheticProduct]} linked={[]} /></div>,
          quotation: <QuotationPanel projectId={syntheticSalesProject.id} rfqs={[]} products={[]} entries={[]} canReview />,
          lead: <LeadPanel projectId={syntheticSalesProject.id} entries={[syntheticLead]} />,
          delivery: <DeliveryPanel projectId={syntheticSalesProject.id} entries={[]} canReview />,
          opportunity: <LeadPanel projectId={syntheticSalesProject.id} entries={[]} />,
        };
        const active = salesStages.some((stage) => stage.id === panel) ? panel! : panel === "lead" ? "follow-up" : "inbound";
        const panelKind = salesStages.find((stage) => stage.id === active)!.panelKind;
        const activePanel = active === "opportunity" ? panels.opportunity : panels[panelKind as keyof typeof panels];
        return <ProjectWorkspace project={syntheticSalesProject} projects={syntheticProjects} tasks={[]} stages={salesStages} activeStage={active} panel={activePanel} basePath="/testing/project-workflow" />;
      }
      const productDetail = state === "product-review" ? syntheticProductDetail : null;
      const contentDetail = state === "content-revision" ? syntheticContentDetail : null;
      const panels = {
        product: <ProductPanel projectId={syntheticMarketingProject.id} entries={productDetail ? [productDetail] : []} detail={productDetail} canReview agentModelConfigs={syntheticAgentModels} />,
        content: <ContentPanel projectId={syntheticMarketingProject.id} products={[syntheticProduct]} entries={contentDetail ? [contentDetail] : []} copyCandidates={[]} detail={contentDetail} canReview />,
        video: <VideoStageEntry projectId={syntheticMarketingProject.id} count={1} pendingReview={state === "review" ? 1 : 0} />,
        publication: <PublicationPanel projectId={syntheticMarketingProject.id} candidates={[]} channels={[]} publications={[]} />,
      };
      const active = marketingStages.some((stage) => stage.id === panel) ? panel! : "product";
      return <ProjectWorkspace project={syntheticMarketingProject} projects={syntheticProjects} tasks={[]} stages={marketingStages} activeStage={active} panel={panels[active as keyof typeof panels]} basePath="/testing/project-workflow" />;
    }

    /** Test-only fixture: production project access remains permission protected. */
    export default function ProjectWorkflowTestingPage({ searchParams }: { searchParams: Promise<{ state?: string; kind?: string; panel?: string }> }) {
      if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
      return <Suspense fallback={null}><ProjectWorkflowFixture searchParams={searchParams} /></Suspense>;
    }
    '''
)
write("app/testing/project-workflow/page.tsx", prefix + fixture_tail)
remove("app/testing/project-canvas")
remove("app/testing/workspace-canvas")

project_workspace_fixture = read("app/testing/project-workspace/page.tsx")
project_workspace_fixture = project_workspace_fixture.replace('import { createWorkspaceTemplate } from "@/lib/workspace/contracts";\n', '')
project_workspace_fixture = project_workspace_fixture.replace('WorkspaceProjectDetail', 'WorkspaceProjectSummary')
project_workspace_fixture = sub_once(
    project_workspace_fixture,
    r'const project: WorkspaceProjectSummary = \{[^\n]+\};',
    'const project: WorkspaceProjectSummary = { id: "00000000-0000-4000-8000-000000000721", title: "Synthetic project workspace", kind: "marketing", status: "active", updatedAt: new Date("2026-09-01T00:00:00Z") };',
    "simple project workflow fixture",
)
write("app/testing/project-workspace/page.tsx", project_workspace_fixture)

write(
    "app/testing/video-workspace/page.tsx",
    dedent(
        '''
        import { Suspense } from "react";
        import { notFound } from "next/navigation";

        import { VideoWorkspace } from "@/components/workspace/video-workspace";
        import type { MarketingVideoEditorEntry, ReadyVideoProductSource } from "@/lib/video/store";

        const projectId = "00000000-0000-4000-8000-000000000721";
        const videoId = "00000000-0000-4000-8000-000000000401";
        const products: ReadyVideoProductSource[] = [{ id: "00000000-0000-4000-8000-000000000301", productName: "Verified clutch kit", internalSku: "SYN-001", factOptions: [{ value: "product.product_name", label: "product.product_name" }] }];

        function entry(state: "draft" | "review" | "approved"): MarketingVideoEditorEntry {
          const reviewed = state !== "draft";
          return {
            id: videoId,
            state: state === "approved" ? "VIDEO_APPROVED" : state === "review" ? "VIDEO_REVIEW_REQUIRED" : "VIDEO_DRAFT",
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
            productId: products[0]!.id,
            productName: products[0]!.productName,
            objective: "Create a concise product inquiry video",
            targetAudience: "Overseas distributors",
            platforms: ["facebook"],
            approvalStatus: state === "approved" ? "approved" : state === "review" ? "pending" : null,
            previewAssetRef: reviewed ? "asset-rendered-preview-001" : null,
            captionFactOptions: [
              { field: "product.product_name", value: "Verified clutch kit" },
              { field: "product.oe_numbers", value: "OE-SYN-001" },
            ],
            downloadAvailable: state === "approved",
            privateTestOnly: false,
            processingJob: null,
            draft: { version: 3, creativeFramework: "google_abcd", platform: "facebook", ctaText: "Contact us", clips: [
              { clipId: "clip-001", assetRef: "evidence-video-001", mediaType: "video", trimStartMs: 0, durationMs: 5_000, fitMode: "contain", audioMode: "muted", caption: { kind: "none" }, abcdRoles: ["attention", "branding"], motionPreset: "punch_in" },
              { clipId: "clip-002", assetRef: "evidence-image-002", mediaType: "image", trimStartMs: 0, durationMs: 3_000, fitMode: "contain", audioMode: "muted", caption: { kind: "none" }, abcdRoles: ["connection", "direction"], motionPreset: "cta_hold" },
            ] },
          };
        }

        async function VideoWorkspaceFixture({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
          const query = await searchParams;
          const state = query.state === "review" || query.state === "approved" ? query.state : "draft";
          const current = entry(state);
          return <VideoWorkspace projectId={projectId} projectTitle="Synthetic project workspace" products={products} entries={[current]} copyCandidates={[]} canReview selectedId={current.id} />;
        }

        export default function VideoWorkspaceTestingPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
          if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
          return <Suspense fallback={null}><VideoWorkspaceFixture searchParams={searchParams} /></Suspense>;
        }
        '''
    ),
)

write(
    "tests/e2e/project-workflow.spec.ts",
    dedent(
        '''
        import { expect, test } from "@playwright/test";

        test("Product Agent keeps saved models selectable in the product step", async ({ page }) => {
          await page.goto("/testing/project-workflow?panel=product");
          await page.waitForLoadState("networkidle");
          const model = page.getByRole("complementary").getByRole("combobox", { name: "模型", exact: true });
          await expect(model).toContainText("日常产品导入 · gpt-5-mini");
          await model.click();
          await expect(page.getByRole("option", { name: "复杂目录识别 · claude-sonnet-test" })).toBeVisible();
        });

        test("product Gate 01 review remains in the product step", async ({ page }) => {
          await page.goto("/testing/project-workflow?panel=product&state=product-review");
          const detail = page.getByRole("complementary");
          await expect(detail.getByText("产品事实与证据")).toBeVisible();
          await expect(detail.getByText("Gate 01 决定")).toBeVisible();
          await expect(detail.getByRole("button", { name: "请先选择决定" })).toBeDisabled();
        });

        test("rejected content exposes revision in the content step", async ({ page }) => {
          await page.goto("/testing/project-workflow?panel=content&state=content-revision");
          const detail = page.getByRole("complementary");
          await expect(detail.getByText("修订内容草稿")).toBeVisible();
          await expect(detail.getByRole("button", { name: "提交修订并送审" })).toBeVisible();
        });

        test("sales demand confirmation includes RFQ and product references", async ({ page }) => {
          await page.goto("/testing/project-workflow?kind=sales&panel=rfq");
          const detail = page.getByRole("complementary");
          await expect(detail.getByText("录入询盘", { exact: true })).toBeVisible();
          await expect(detail.getByText("添加产品引用", { exact: true })).toBeVisible();
          await expect(detail.getByText("Verified clutch kit")).toBeVisible();
        });

        test("sales quotation stays explicitly human controlled", async ({ page }) => {
          await page.goto("/testing/project-workflow?kind=sales&panel=quotation");
          const detail = page.getByRole("complementary");
          await expect(detail.getByText("创建人工报价", { exact: true })).toBeVisible();
          await expect(detail.getByRole("button", { name: /自动报价/ })).toHaveCount(0);
        });

        test("follow-up shows the authorized timeline and explicit human send", async ({ page }) => {
          await page.goto("/testing/project-workflow?kind=sales&panel=follow-up");
          const detail = page.getByRole("complementary");
          await expect(detail.getByText("授权消息时间线", { exact: true })).toBeVisible();
          await expect(detail.getByText("Synthetic buyer asks for the verified lead time.")).toBeVisible();
          await expect(detail.getByRole("button", { name: "人工确认并发送此回复" })).toBeEnabled();
          await detail.getByRole("combobox", { name: "当前场景" }).click();
          await page.getByRole("option", { name: "询问交期" }).click();
          await expect(detail.getByText("将插入已确认交期：21 天")).toBeVisible();
        });

        test("publication waits for explicit confirmation and platform receipt", async ({ page }) => {
          await page.goto("/testing/project-workflow?panel=publication");
          const detail = page.getByRole("complementary");
          await expect(detail.getByText("确认并提交发布", { exact: true })).toBeVisible();
          await expect(detail.getByText("平台回执前不会显示为已发布", { exact: false })).toBeVisible();
          await expect(detail.getByRole("button", { name: "确认并提交此条发布" })).toBeDisabled();
        });

        test("desktop detail region is viewport-bound and scrolls internally", async ({ page }) => {
          await page.setViewportSize({ width: 1024, height: 600 });
          await page.goto("/testing/project-workflow?panel=product");
          const detail = page.getByRole("complementary");
          await expect(detail.locator('[data-slot="scroll-area-viewport"]')).toHaveCSS("overflow-y", "scroll");
        });
        '''
    ),
)

write(
    "tests/e2e/video-workspace.spec.ts",
    dedent(
        '''
        import { expect, test } from "@playwright/test";

        test("video editor opens the selected draft in a dedicated workspace", async ({ page }) => {
          await page.goto("/testing/video-workspace");
          await expect(page.getByRole("heading", { name: "视频编辑器" })).toBeVisible();
          await expect(page.getByText("最长 15 秒")).toBeVisible();
          await expect(page.getByText("8.0 / 15 秒")).toBeVisible();
        });

        test("video editor blocks a draft longer than 15 seconds", async ({ page }) => {
          await page.goto("/testing/video-workspace");
          const durations = page.getByLabel("成片时长（秒）");
          await durations.nth(0).fill("10");
          await durations.nth(1).fill("10");
          await expect(page.getByText("视频过长")).toBeVisible();
          await expect(page.getByRole("button", { name: "合成预览" })).toBeDisabled();
        });

        test("verified captions remain server controlled", async ({ page }) => {
          await page.goto("/testing/video-workspace");
          await page.getByLabel("字幕类型").first().selectOption("creative");
          await page.getByLabel("创意字幕").fill("OE 99999");
          await page.getByRole("button", { name: "保存", exact: true }).click();
          await expect(page.getByText("创意文案不能包含工程或商业事实；请改用核验事实字段。")).toBeVisible();
          await page.getByLabel("字幕类型").first().selectOption("verified_fact");
          await expect(page.getByLabel("事实字段")).toContainText("product.product_name · Verified clutch kit");
        });

        test("returning to the project protects an unsaved video draft", async ({ page }) => {
          await page.goto("/testing/video-workspace");
          await page.getByLabel("成片时长（秒）").first().fill("6");
          await page.getByRole("link", { name: "返回营销视频步骤" }).click();
          const alert = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
          await expect(alert).toBeVisible();
          await alert.getByRole("button", { name: "继续编辑" }).click();
          await expect(page).toHaveURL(/\/testing\/video-workspace/);
        });

        test("video workspace exposes upload and post-render review without generation controls", async ({ page }) => {
          await page.goto("/testing/video-workspace");
          await page.getByRole("button", { name: "新建" }).click();
          await expect(page.getByLabel("素材（1–3 个）")).toHaveAttribute("accept", /video\/mp4/);
          await expect(page.getByLabel("素材权利证据")).toBeVisible();
          await expect(page.getByText("不会调用视频生成模型")).toBeVisible();
          await expect(page.getByRole("button", { name: /生成视频|模型配置|供应商/ })).toHaveCount(0);

          await page.goto("/testing/video-workspace?state=review");
          await expect(page.getByText("私有预览")).toBeVisible();
          await expect(page.locator("video")).toHaveAttribute("src", /\/api\/video-preview\/asset-rendered-preview-001$/);
        });
        '''
    ),
)
remove("tests/e2e/project-canvas.spec.ts")
remove("tests/e2e/workspace-canvas.spec.ts")

workspace_dashboard_test = read("tests/e2e/workspace-dashboard.spec.ts")
workspace_dashboard_test = workspace_dashboard_test.replace('  await expect(page.locator(".react-flow")).toHaveCount(0);\n', '')
workspace_dashboard_test = sub_once(
    workspace_dashboard_test,
    r'\ntest\("project flow remains an optional read-only diagnostic view"[\s\S]*?\n\}\);\n?$',
    '\n',
    "diagnostic flow test",
)
write("tests/e2e/workspace-dashboard.spec.ts", workspace_dashboard_test)

write(
    "scripts/test-workspace-contracts.ts",
    dedent(
        '''
        import assert from "node:assert/strict";

        import { createWorkspaceProjectSchema } from "../lib/workspace/contracts";
        import { workspaceTaskHref } from "../lib/workspace/navigation";
        import type { WorkspaceTaskSummary } from "../lib/workspace/store";

        assert.equal(createWorkspaceProjectSchema.parse({ kind: "marketing", title: "  Synthetic marketing project  " }).title, "Synthetic marketing project");
        assert.throws(() => createWorkspaceProjectSchema.parse({ kind: "invalid", title: "x" }));
        assert.throws(() => createWorkspaceProjectSchema.parse({ kind: "sales", title: "" }));

        const task: WorkspaceTaskSummary = {
          id: "00000000-0000-4000-8000-000000000101",
          projectId: "00000000-0000-4000-8000-000000000102",
          projectTitle: "Synthetic project",
          nodeKind: "content",
          title: "Review content",
          detail: "Waiting for a human",
          priority: "review",
          createdAt: new Date("2026-09-04T00:00:00Z"),
        };
        assert.equal(workspaceTaskHref(task), `/workspace/${task.projectId}?panel=content&item=${task.id}`);
        assert.equal(workspaceTaskHref({ ...task, nodeKind: "video" }), `/workspace/${task.projectId}/video?item=${task.id}`);
        assert.equal(workspaceTaskHref(task, "/testing/project-workspace"), `/testing/project-workspace?panel=content&item=${task.id}`);

        console.log("PASS workspace project navigation contracts");
        '''
    ),
)

validator = read("scripts/validate_repository.py")
validator = sub_once(
    validator,
    r'def check_database_baseline\(\) -> None:[\s\S]*?(?=\ndef check_service_adapters)',
    dedent(
        '''
        def check_database_baseline() -> None:
            database_client = (ROOT / "lib/db/client.ts").read_text(encoding="utf-8")
            for required in ("drizzle-orm/neon-serverless", "new Pool", "closeDatabase"):
                if required not in database_client:
                    raise AssertionError(f"Database client must support transactions: {required}")
            if "drizzle-orm/neon-http" in database_client:
                raise AssertionError("Database client must not use the transactionless neon-http driver")
            auth_source = (ROOT / "lib/auth.ts").read_text(encoding="utf-8")
            for required in (
                'emailAndPassword: { enabled: false }',
                "emailOTP({",
                "disableSignUp: true",
                "sendVerificationOTP: sendEmailOtp",
                "passkey({",
                "rpID: process.env.BETTER_AUTH_PASSKEY_RP_ID",
                "invitationActivationPlugin()",
            ):
                if required not in auth_source:
                    raise AssertionError(f"Passwordless Better Auth configuration is missing: {required}")
            proxy_source = (ROOT / "proxy.ts").read_text(encoding="utf-8")
            for required in ("getSessionCookie", 'matcher: ["/workspace/:path*"]'):
                if required not in proxy_source:
                    raise AssertionError(f"Optimistic workspace proxy protection is missing: {required}")
            if "auth.api.getSession" in proxy_source:
                raise AssertionError("Workspace Proxy must not query the session database")
            role_guard_source = (ROOT / "lib/auth-guard.ts").read_text(encoding="utf-8")
            for required in ("requireRole", "auth.api.getSession", "allowedRoles.includes"):
                if required not in role_guard_source:
                    raise AssertionError(f"Strict server role guard is missing: {required}")
            next_config = (ROOT / "next.config.ts").read_text(encoding="utf-8")
            for required in ('source: "/admin/:path*"', 'destination: "/workspace"', "permanent: true"):
                if required not in next_config:
                    raise AssertionError(f"Workspace route migration is missing: {required}")
            invitation_actions = (ROOT / "lib/actions/invitations.ts").read_text(encoding="utf-8")
            for required in ('"use server"', "auth.api.getSession", "issueInvitation", "provisionInvitedUser", "invitationFormSchema.safeParse"):
                if required not in invitation_actions:
                    raise AssertionError(f"Invitation Server Action contract is missing: {required}")

            workspace_action_dock = (ROOT / "components/workspace/workspace-action-dock.tsx").read_text(encoding="utf-8")
            for required in ("useForm", "zodResolver", "createWorkspaceProjectAction", "FieldError"):
                if required not in workspace_action_dock:
                    raise AssertionError(f"Workspace project form contract is missing: {required}")
            workspace_loading = (ROOT / "components/workspace/workspace-loading-skeleton.tsx").read_text(encoding="utf-8")
            for required in ("WorkspaceLoadingSkeleton", "Skeleton", "工作台"):
                if required not in workspace_loading:
                    raise AssertionError(f"Workspace loading shell is missing: {required}")
            workspace_schema = (ROOT / "lib/db/schema.ts").read_text(encoding="utf-8")
            for required in ("workspaceItemRelation", "workspace_project_item_single_owner_uidx", "workspace_project_item_relation_matches_role"):
                if required not in workspace_schema:
                    raise AssertionError(f"Workspace ownership contract is missing: {required}")
            for forbidden in ("workspaceCanvasDocument", '"workspace_canvas_document"'):
                if forbidden in workspace_schema:
                    raise AssertionError(f"Retired project canvas persistence remains in the active schema: {forbidden}")
            for route in (ROOT / "app/workspace/page.tsx", ROOT / "app/workspace/[projectId]/page.tsx", ROOT / "app/workspace/[projectId]/video/page.tsx"):
                source = route.read_text(encoding="utf-8")
                if "WorkspaceLoadingSkeleton" not in source or "WorkspaceCanvasSkeleton" in source or "ProjectCanvas" in source or "view=flow" in source:
                    raise AssertionError(f"Workspace route still references the retired canvas shell: {route}")
            retired_paths = (
                ROOT / "components/workspace/project-canvas.tsx",
                ROOT / "components/workspace/workspace-hub.tsx",
                ROOT / "components/workspace/canvas-nodes.tsx",
                ROOT / "components/workspace/workspace-canvas-skeleton.tsx",
                ROOT / "app/testing/project-canvas",
                ROOT / "app/testing/workspace-canvas",
                ROOT / "tests/e2e/project-canvas.spec.ts",
                ROOT / "tests/e2e/workspace-canvas.spec.ts",
            )
            existing_retired = [str(path.relative_to(ROOT)) for path in retired_paths if path.exists()]
            if existing_retired:
                raise AssertionError(f"Retired project canvas files still exist: {existing_retired}")
            package = load_json(ROOT / "package.json")
            for dependency in ("@xyflow/react", "elkjs"):
                if dependency in package.get("dependencies", {}) or dependency in package.get("devDependencies", {}):
                    raise AssertionError(f"Retired canvas dependency remains: {dependency}")
            for path in (
                ROOT / "lib/workspace/contracts.ts",
                ROOT / "lib/actions/workspace.ts",
                ROOT / "lib/workspace/store.ts",
                ROOT / "lib/social/inbound-routing-store.ts",
            ):
                source = path.read_text(encoding="utf-8")
                for forbidden in ("workspaceCanvasDocument", "WorkspaceCanvasDocument", "saveWorkspaceCanvas", "createWorkspaceTemplate"):
                    if forbidden in source:
                        raise AssertionError(f"Retired canvas token {forbidden} remains in {path.relative_to(ROOT)}")
            css = (ROOT / "app/globals.css").read_text(encoding="utf-8")
            if "react-flow" in css:
                raise AssertionError("React Flow styles remain in app/globals.css")
            if (ROOT / "components/console-loading.tsx").exists():
                raise AssertionError("Legacy Console loading component must be removed")

            product_actions = (ROOT / "lib/actions/products.ts").read_text(encoding="utf-8")
            for required in (
                '"use server"', "auth.api.getSession", "productCatalogFormSchema.safeParse",
                "productReviewFormSchema.safeParse", "createProductCatalogDraft",
                "decideProductCatalogReview", "reviseProductCatalogDraft", 'revalidatePath("/workspace")',
            ):
                if required not in product_actions:
                    raise AssertionError(f"Product catalog Server Action contract is missing: {required}")
            content_actions = (ROOT / "lib/actions/content.ts").read_text(encoding="utf-8")
            for required in ("contentDraftFormSchema.safeParse", "contentReviewFormSchema.safeParse", "createContentDraft", "decideContentReview", "reviseContentDraft"):
                if required not in content_actions:
                    raise AssertionError(f"Content Server Action contract is missing: {required}")

            migrations = sorted((ROOT / "drizzle").glob("*.sql"))
            if not migrations:
                raise AssertionError("At least one Drizzle SQL migration is required")
            migration = "\\n".join(path.read_text(encoding="utf-8") for path in migrations)
            if 'DROP TABLE "workspace_canvas_document"' not in migration:
                raise AssertionError("Database migration must remove retired workspace canvas persistence")
            required_tables = {
                "user", "session", "account", "verification", "invitation",
                "aggregate_record", "approval", "evidence", "workflow_event", "audit_event", "passkey",
            }
            missing_tables = [table for table in sorted(required_tables) if f'CREATE TABLE "{table}"' not in migration]
            if missing_tables:
                raise AssertionError(f"Database migration is missing tables: {missing_tables}")
            for trigger in ("audit_event_append_only", "workflow_event_append_only"):
                if f'CREATE TRIGGER "{trigger}"' not in migration:
                    raise AssertionError(f"Database migration is missing trigger: {trigger}")
            if "decided_by_type\\" = 'human'" not in migration:
                raise AssertionError("Approval decisions must be constrained to a human actor")
            for required in (
                'CREATE TABLE "social_inbound_delivery"',
                'CREATE UNIQUE INDEX "social_inbound_delivery_external_uidx"',
                '"channel_ref","account_ref","message_id"',
            ):
                if required not in migration:
                    raise AssertionError(f"Database migration is missing durable inbound delivery control: {required}")
            inbound_store = (ROOT / "lib/social/inbound-delivery-store.ts").read_text(encoding="utf-8")
            for required in ("onConflictDoNothing", "socialInboundDelivery.messageId", "ignore_duplicate"):
                if required not in inbound_store:
                    raise AssertionError(f"Inbound delivery store is missing atomic deduplication behavior: {required}")

        '''
    ),
    "database baseline validator",
)
write("scripts/validate_repository.py", validator)

readme = read("README.md")
readme = replace_once(
    readme,
    '项目画布已退出生产主导航。历史布局数据和 `?view=flow` 只读诊断视图暂时保留，用于迁移核对和回滚；它们不再决定业务入口，也不保存产品事实、报价、交期、审批或发布结果。后续删除条件见 ADR 0005。',
    '项目画布、布局存储和 React Flow 依赖已经从生产代码删除。项目只保留受控业务记录、成员关系和阶段导航；产品事实、报价、交期、审批与发布结果继续由领域状态机保存。迁移记录见 ADR 0005。',
    "README canvas migration status",
)
write("README.md", readme)

adr = read("docs/decisions/0005-guided-workspace-navigation.md")
adr = sub_once(
    adr,
    r'### 4\. 画布迁移[\s\S]*?(?=### 5\. 安全与领域边界)',
    dedent(
        '''
        ### 4. 画布迁移

        2026-09-04，Issue #258 完成破坏性清理：

        - 删除项目总画布、项目节点画布、缩放／拖拽控件和测试专用画布路由。
        - 删除 `workspace_canvas_document` 表、保存 Action、布局契约和乐观 revision 控制。
        - 删除 `@xyflow/react`、`elkjs` 及对应全局样式。
        - 项目创建和入站分流不再生成布局记录；历史项目直接从 `workspace_project` 加载。
        - `?view=flow` 诊断入口已经移除，避免形成第二套导航模型。
        - 个人 `video_canvas_document` 属于另一套遗留视频实验，仍须独立完成调用方和数据审计，不在本次迁移中删除。

        '''
    ),
    "ADR canvas migration section",
)
adr = adr.replace('短期内仓库仍保留未暴露的画布代码和表；这是有意的渐进迁移，不代表继续投资画布功能。', '项目画布代码、持久化和依赖已清理，仓库只保留线性工作流与专用视频编辑器。')
write("docs/decisions/0005-guided-workspace-navigation.md", adr)

status = read("docs/PROJECT_STATUS.md")
status = replace_once(
    status,
    '应用以工作台和固定项目步骤组织受控记录；项目画布已退出生产主导航，只保留短期只读诊断视图，详见[工作台与项目采用线性引导流程](decisions/0005-guided-workspace-navigation.md)。',
    '应用以工作台和固定项目步骤组织受控记录；项目画布、布局表和 React Flow 依赖均已删除，详见[工作台与项目采用线性引导流程](decisions/0005-guided-workspace-navigation.md)。',
    "project status canvas cleanup",
)
write("docs/PROJECT_STATUS.md", status)

video_acceptance = read("docs/testing/video-workflow-acceptance.md")
video_acceptance = video_acceptance.replace('tests/e2e/workspace-dashboard.spec.ts tests/e2e/project-canvas.spec.ts', 'tests/e2e/project-workflow.spec.ts tests/e2e/video-workspace.spec.ts')
write("docs/testing/video-workflow-acceptance.md", video_acceptance)

for retired in ("components/workspace/project-canvas.tsx", "components/workspace/workspace-hub.tsx", "components/workspace/canvas-nodes.tsx"):
    remove(retired)

print("Applied project-canvas cleanup. Dependency removal and Drizzle generation remain for the workflow.")
