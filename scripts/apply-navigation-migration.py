from pathlib import Path
import json
import re

ROOT = Path.cwd()

def read(path):
    return (ROOT / path).read_text()

def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + '\n')

def replace(path, old, new):
    text = read(path)
    assert old in text, (path, old)
    write(path, text.replace(old, new))

# Preserve the business stage vocabulary while making entry selection independently testable.
old_page = read('app/workspace/[projectId]/page.tsx')
stages = old_page[old_page.index('const marketingStages:'):old_page.index('type ProjectQuery')]
stages = stages.replace('const marketingStages:', 'export const marketingStages:').replace('const salesStages:', 'export const salesStages:')
write('lib/workspace/stages.ts', '''import type { WorkspaceTaskSummary } from './store';
export type ProjectStage = { id: string; panelKind: string; label: string; description: string };
export type ProjectKind = 'marketing' | 'sales';
export type StageRecord = { type: string; state: string };
''' + stages + '''
export function projectStages(kind: ProjectKind) {
  return kind === 'marketing' ? marketingStages : salesStages;
}
export function requestedProjectStage(kind: ProjectKind, panel?: string, taskType?: WorkspaceTaskSummary['taskType']) {
  if (projectStages(kind).some((stage) => stage.id === panel)) return panel;
  if (kind === 'sales' && panel === 'lead') return taskType === 'opportunity' ? 'opportunity' : taskType === 'follow_up' ? 'follow-up' : 'inbound';
  return undefined;
}
export function defaultProjectStage(kind: ProjectKind, tasks: WorkspaceTaskSummary[], records: StageRecord[], hasPublication: boolean) {
  if (kind === 'marketing') {
    const next = tasks.find((task) => marketingStages.some((stage) => stage.panelKind === task.nodeKind));
    return next?.nodeKind ?? (hasPublication ? 'publication' : records.some((row) => row.type === 'video') ? 'video' : records.some((row) => row.type === 'content') ? 'content' : 'product');
  }
  return records.some((row) => row.type === 'lead' && row.state === 'OPPORTUNITY') ? 'opportunity'
    : records.some((row) => row.type === 'delivery_confirmation' && row.state === 'DELIVERY_CONFIRMATION_PENDING') ? 'delivery'
    : records.some((row) => row.type === 'lead') ? 'follow-up'
    : records.some((row) => row.type === 'quotation') ? 'quotation' : 'rfq';
}
''')

# React.cache is request-scoped; authorization is never persisted in a shared data cache.
replace('lib/auth-guard.ts', 'import { headers } from "next/headers";', 'import { cache } from "react";\nimport { headers } from "next/headers";')
text = read('lib/auth-guard.ts')
text = text.replace('await auth.api.getSession({ headers: await headers() })', 'await getRequestSession()')
text = text.replace('/**', 'const getRequestSession = cache(async () => auth.api.getSession({ headers: await headers() }));\n\n/**', 1)
write('lib/auth-guard.ts', text)

# Four independent task queries used to be serial. Keep membership filtering even for scoped reads.
path = 'lib/workspace/store.ts'
text = read(path)
start = text.index('export async function listWorkspaceTasks(')
end = text.index('export async function listWorkspacePipeline(', start)
part = text[start:end]
part = part.replace('database: Database = getDatabase(),\n)', 'database: Database = getDatabase(),\n  projectId?: string,\n)', 1)
part = part.replace('.where(eq(workspaceProjectMember.userId, actorId));', '.where(and(eq(workspaceProjectMember.userId, actorId), projectId ? eq(workspaceProjectMember.projectId, projectId) : undefined));', 1)
for name in ('reviewRows', 'rfqRows', 'leadRows', 'publicationRows'):
    assert f'const {name} = await database' in part
    part = part.replace(f'const {name} = await database', f'const {name}Query = database', 1)
part = part.replace('  const publicationStates =', '  const [reviewRows, rfqRows, leadRows, publicationRows] = await Promise.all([reviewRowsQuery, rfqRowsQuery, leadRowsQuery, publicationRowsQuery]);\n  const publicationStates =', 1)
text = text[:start] + part + text[end:]
start = text.index('export async function listWorkspacePipeline(')
end = text.index('export async function createWorkspaceProject(', start)
part = text[start:end]
part = part.replace('const rows = await database', 'const rowsQuery = database', 1).replace('const published = await database', 'const publishedQuery = database', 1)
part = part.replace('  const marketingByPublication =', '  const [rows, published] = await Promise.all([rowsQuery, publishedQuery]);\n  const marketingByPublication =', 1)
write(path, text[:start] + part + text[end:])

write('lib/workspace/read-model.ts', '''import 'server-only';
import { and, eq } from 'drizzle-orm';
import { cache } from 'react';
import { listStoredProductAgentModelSettings } from '@/lib/ai/product-agent-model-config';
import { getDatabase } from '@/lib/db/client';
import { aggregateRecord, socialPublication, workspaceProjectItem } from '@/lib/db/schema';
import { defaultProjectStage } from './stages';
import { getWorkspaceProject, listWorkspaceProjects, listWorkspaceTasks, type WorkspaceProjectSummary } from './store';

// Deduplicate only inside a single RSC request. Do not use a cross-user persistent cache here.
export const readWorkspaceProjects = cache((actorId: string) => listWorkspaceProjects(actorId));
export const readWorkspaceTasks = cache((actorId: string, projectId?: string) => listWorkspaceTasks(actorId, undefined, projectId));
export const readWorkspaceProject = cache((projectId: string, actorId: string) => getWorkspaceProject(projectId, actorId));
export const readWorkspaceModelSettings = cache(() => listStoredProductAgentModelSettings());

// Called only after readWorkspaceProject has authenticated project membership.
// Explicit ?panel= navigation never calls this lightweight entry-point fallback.
export async function readDefaultProjectStage(project: WorkspaceProjectSummary, actorId: string) {
  const tasks = project.kind === 'marketing' ? await readWorkspaceTasks(actorId, project.id) : [];
  if (tasks.length && project.kind === 'marketing') {
    const next = defaultProjectStage(project.kind, tasks, [], false);
    if (tasks.some((task) => task.nodeKind === next)) return next;
  }
  const database = getDatabase();
  const [records, publications] = await Promise.all([
    database.select({ type: aggregateRecord.type, state: aggregateRecord.state }).from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(and(eq(workspaceProjectItem.projectId, project.id), eq(workspaceProjectItem.relation, 'owned'))),
    project.kind === 'marketing' ? database.select({ id: socialPublication.id }).from(socialPublication).where(eq(socialPublication.projectId, project.id)).limit(1) : Promise.resolve([]),
  ]);
  return defaultProjectStage(project.kind, tasks, records, publications.length > 0);
}
''')

# Existing standalone test pages may keep a provider, but they must not shadow the layout's guard.
path = 'components/workspace/dirty-state.tsx'
text = read(path)
text = text.replace('  dirty: boolean;', '  dirty: boolean;\n  discardVersion: number;', 1)
text = text.replace('export function WorkspaceDirtyProvider({ children }: { children: ReactNode }) {', '''export function WorkspaceDirtyProvider({ children }: { children: ReactNode }) {
  const parent = useContext(DirtyStateContext);
  return parent ? children : <WorkspaceDirtyRoot>{children}</WorkspaceDirtyRoot>;
}

function WorkspaceDirtyRoot({ children }: { children: ReactNode }) {
  const [discardVersion, setDiscardVersion] = useState(0);''', 1)
text = text.replace('    setConfirmOpen(false);\n    action?.();', '    setConfirmOpen(false);\n    setDirtyKeys(new Set());\n    setDiscardVersion((version) => version + 1);\n    action?.();', 1)
text = text.replace('() => ({ dirty, setDirty, requestNavigation }),\n    [dirty, requestNavigation, setDirty],', '() => ({ dirty, discardVersion, setDirty, requestNavigation }),\n    [dirty, discardVersion, requestNavigation, setDirty],', 1)
write(path, text)

write('components/workspace/workspace-link.tsx', '''"use client";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { useWorkspaceDirtyState } from './dirty-state';

type Props = Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & { href: string; onFollow?: () => void };
export function WorkspaceLink({ href, onFollow, ...props }: Props) {
  const router = useRouter();
  const { dirty, requestNavigation } = useWorkspaceDirtyState();
  return <Link {...props} href={href} onNavigate={(event) => {
    if (!dirty) { onFollow?.(); return; }
    event.preventDefault();
    requestNavigation(() => { onFollow?.(); router.push(href); });
  }} />;
}
''')
write('components/workspace/workspace-shell.tsx', '''"use client";
import type { ReactNode } from 'react';
import { WorkspaceDirtyProvider } from './dirty-state';

// The dock is a sibling of page/loading boundaries, not a child of an async page.
export function WorkspaceShell({ children, dock }: { children: ReactNode; dock: ReactNode }) {
  return <WorkspaceDirtyProvider>{children}{dock}</WorkspaceDirtyProvider>;
}
''')

# Native Next links retain prefetching and modifier-key behavior, unlike buttons calling router.push.
path = 'components/workspace/workspace-action-dock.tsx'
text = read(path)
text = text.replace('import { useRouter } from "next/navigation";', 'import { useParams, useRouter } from "next/navigation";')
text = text.replace('import { Button } from "@/components/ui/button";', 'import { Button, buttonVariants } from "@/components/ui/button";\nimport { WorkspaceLink } from "./workspace-link";')
text = text.replace('  activeProjectId,', '  activeProjectId: initialActiveProjectId,\n  basePath = "/workspace",', 1)
text = text.replace('  activeProjectId?: string;', '  activeProjectId?: string;\n  basePath?: string;', 1)
text = text.replace('  const router = useRouter();', '  const router = useRouter();\n  const params = useParams();\n  const activeProjectId = typeof params.projectId === "string" ? params.projectId : initialActiveProjectId;', 1)
text = text.replace('const { requestNavigation } = useWorkspaceDirtyState();', 'const { requestNavigation, discardVersion } = useWorkspaceDirtyState();', 1)
start = text.index('  function navigate(url: string)')
end = text.index('  function submit(', start)
text = text[:start] + '''  useEffect(() => {
    if (!discardVersion) return;
    form.reset();
    setCreateOpen(false);
    setPanel(null);
  }, [discardVersion, form]);
''' + text[end:]
text = text.replace('`/workspace/${state.projectId}`', '`${basePath}/${state.projectId}`')
text = text.replace('[form, router, state.projectId, state.status]', '[basePath, form, router, state.projectId, state.status]')
text = text.replace('`/workspace/${project.id}`', '`${basePath}/${project.id}`')
text = text.replace('navigate("/workspace")', 'navigate(basePath)')
text = text.replace('workspaceTaskHref(task)', 'workspaceTaskHref(task, `${basePath}/${task.projectId}`)')
def link_button(match):
    value = match.group(0)
    if 'navigate(' not in value:
        return value
    handler = re.search(r'onClick=\{\(\) => navigate\((.*?)\)\}', value, re.S)
    assert handler, value
    variant = re.search(r'variant=(\{.*?\}|".*?")', value, re.S)
    assert variant
    variant_expr = variant.group(1)
    if variant_expr.startswith('{'):
        variant_expr = variant_expr[1:-1]
    value = value.replace(variant.group(0), '')
    value = value.replace(handler.group(0), 'href={' + handler.group(1) + '} onFollow={() => setPanel(null)}')
    classes = re.search(r'className="([^"]*)"', value)
    assert classes
    value = value.replace(classes.group(0), 'className={buttonVariants({ variant: ' + variant_expr + ', className: "' + classes.group(1) + '" })}')
    value = value.replace('<Button', '<WorkspaceLink', 1).replace('</Button>', '</WorkspaceLink>')
    if 'project.id === activeProjectId' in value:
        value = value.replace('href={', 'aria-current={project.id === activeProjectId ? "page" : undefined} href={', 1)
    return value
text = re.sub(r'<Button\b(?:(?!</Button>).)*</Button>', link_button, text, flags=re.S)
text = text.replace('aria-label="工作台操作"', 'aria-label="工作台操作" data-testid="workspace-action-dock"', 1)
write(path, text)

# A page skeleton must not cover or imitate the persistent dock.
path = 'components/workspace/workspace-loading-skeleton.tsx'
text = read(path).replace('fixed inset-0 overflow-y-auto bg-muted/30', 'min-h-screen overflow-x-hidden bg-muted/30 pb-24')
text = text.replace('Array.from({ length: 4 }).map((_, index)', '["first", "second", "third", "fourth"].map((key)').replace('key={index}', 'key={key}')
start = text.index('      <div className="fixed bottom-3')
end = text.index('    </main>', start)
text = text[:start] + text[end:]
write(path, text + '''
export function WorkspaceDockSkeleton() {
  return <div aria-label="正在加载工作台操作" role="status" className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-2 rounded-2xl border bg-background p-2">
    {['projects', 'create', 'tasks', 'tools'].map((key) => <Skeleton key={key} className="h-11 w-16" />)}
  </div>;
}
export function WorkspacePanelSkeleton({ label = '正在加载当前步骤' }: { label?: string }) {
  return <div role="status" aria-label={label} aria-busy="true" className="space-y-4 p-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-48 w-full" /></div>;
}
''')

write('components/workspace/workspace-dock-data.tsx', '''import 'server-only';
import { Suspense } from 'react';
import { requirePermission } from '@/lib/auth-guard';
import { hasPermission } from '@/lib/authz';
import { readWorkspaceModelSettings, readWorkspaceProjects, readWorkspaceTasks } from '@/lib/workspace/read-model';
import { WorkspaceActionDock } from './workspace-action-dock';
import { WorkspacePanelSkeleton } from './workspace-loading-skeleton';
import { WorkspaceSettingsPanel } from './workspace-settings-panel';

async function Settings({ session }: { session: Awaited<ReturnType<typeof requirePermission>> }) {
  const settings = await readWorkspaceModelSettings();
  return <WorkspaceSettingsPanel settings={settings} currentUser={session.user} canManage={hasPermission(session.user.role, 'settings:manage')} />;
}
export async function WorkspaceDockData() {
  const session = await requirePermission('workspace:view');
  const [projects, tasks] = await Promise.all([readWorkspaceProjects(session.user.id), readWorkspaceTasks(session.user.id)]);
  return <WorkspaceActionDock projects={projects} tasks={tasks} settingsPanel={<Suspense fallback={<WorkspacePanelSkeleton label="正在加载账号与工具" />}><Settings session={session} /></Suspense>} />;
}
''')
write('app/workspace/layout.tsx', '''import { Suspense, type ReactNode } from 'react';
import { WorkspaceDockData } from '@/components/workspace/workspace-dock-data';
import { WorkspaceDockSkeleton } from '@/components/workspace/workspace-loading-skeleton';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell dock={<Suspense fallback={<WorkspaceDockSkeleton />}><WorkspaceDockData /></Suspense>}>{children}</WorkspaceShell>;
}
''')
write('app/workspace/loading.tsx', '''import { WorkspaceLoadingSkeleton } from '@/components/workspace/workspace-loading-skeleton';
export default function Loading() { return <WorkspaceLoadingSkeleton />; }
''')

# Extract the existing task UI intact, so its data can stream independently of the header and panel.
path = 'components/workspace/project-workspace.tsx'
text = read(path)
text = text.replace('import Link from "next/link";', 'import { WorkspaceLink } from "./workspace-link";')
text = text.replace('import { WorkspaceActionDock } from "./workspace-action-dock";\n', '')
start = text.index('function GuardedLink(')
end = text.index('export function VideoStageEntry(', start)
text = text[:start] + '''function GuardedLink({ href, children, className, current = false }: { href: string; children: ReactNode; className: string; current?: boolean }) {
  return <WorkspaceLink href={href} aria-current={current ? 'step' : undefined} className={className}>{children}</WorkspaceLink>;
}

''' + text[end:]
text = text.replace('  projects: WorkspaceProjectSummary[];\n', '').replace('  settingsPanel?: ReactNode;\n', '')
text = text.replace('  tasks: WorkspaceTaskSummary[];', '  tasks?: WorkspaceTaskSummary[];\n  tasksPanel?: ReactNode;', 1)
text = text.replace('  projects,\n', '').replace('  settingsPanel,\n', '').replace('  tasks,\n', '  tasks = [],\n  tasksPanel,\n', 1)
start = text.index('  const projectTasks =')
end = text.index('  function returnToWorkspace', start)
logic = text[start:end]
text = text[:start] + '  const stage = stages.find((item) => item.id === activeStage) ?? stages[0]!;\n' + text[end:]
start = text.index('          <div className="min-w-0 space-y-5">')
end = text.index('          <aside aria-label', start)
left = text[start:end].strip()
text = text[:start] + '          {tasksPanel ?? <ProjectStageTasks projectId={project.id} tasks={tasks} stage={stage} basePath={basePath} />}\n' + text[end:]
text = re.sub(r'      <WorkspaceActionDock[\s\S]*?/>\n', '', text, count=1)
logic = logic.replace('project.id', 'projectId')
logic = re.sub(r'  const stage = stages.find[^\n]*\n', '', logic)
text += '\nexport function ProjectStageTasks({ projectId, tasks, stage, basePath = `/workspace/${projectId}` }: { projectId: string; tasks: WorkspaceTaskSummary[]; stage: ProjectStage; basePath?: string }) {\n' + logic + '\n  return (' + left + ');\n}\n'
write(path, text)
for path in ('app/testing/project-workspace/page.tsx', 'app/testing/project-workflow/page.tsx'):
    text = read(path)
    text = re.sub(r'^\s*projects=\{(?:\[project\]|syntheticProjects)\}\n', '\n', text, flags=re.M)
    write(path, text)
path = 'components/workspace/workspace-dashboard.tsx'
text = read(path).replace('import Link from "next/link";', 'import { WorkspaceLink as Link } from "./workspace-link";')
text = text.replace('import { WorkspaceActionDock } from "./workspace-action-dock";\n', '').replace('  settingsPanel,\n', '').replace('  settingsPanel?: ReactNode;\n', '')
text = re.sub(r'        <WorkspaceActionDock[\s\S]*?/>\n', '', text, count=1)
write(path, text)

write('app/workspace/page.tsx', '''import { connection } from 'next/server';
import { Suspense } from 'react';
import { WorkspaceDashboard } from '@/components/workspace/workspace-dashboard';
import { WorkspaceLoadingSkeleton } from '@/components/workspace/workspace-loading-skeleton';
import { requirePermission } from '@/lib/auth-guard';
import { hasPermission } from '@/lib/authz';
import { listUnassignedInboundConversations } from '@/lib/social/inbound-routing-store';
import { readWorkspaceProjects, readWorkspaceTasks } from '@/lib/workspace/read-model';
import { listWorkspacePipeline } from '@/lib/workspace/store';
async function WorkspaceContent() {
  await connection();
  const session = await requirePermission('workspace:view');
  const [projects, tasks, pipeline, inbound] = await Promise.all([
    readWorkspaceProjects(session.user.id), readWorkspaceTasks(session.user.id), listWorkspacePipeline(session.user.id),
    hasPermission(session.user.role, 'sales:write') ? listUnassignedInboundConversations() : Promise.resolve([]),
  ]);
  return <WorkspaceDashboard projects={projects} tasks={tasks} pipeline={pipeline} inbound={inbound} currentTime={Date.now()} />;
}
export default function WorkspacePage() { return <Suspense fallback={<WorkspaceLoadingSkeleton />}><WorkspaceContent /></Suspense>; }
''')

# Only the active panel performs business reads. All callers authorize before rendering this slot.
write('components/workspace/project-stage-panel.tsx', '''import 'server-only';
import { Suspense } from 'react';
import { DeliveryPanel, LeadPanel, PublicationPanel, QuotationPanel } from './closing-panels';
import { ContentPanel } from './content-panel';
import { ProductMediaPanel } from './product-media-panel';
import { ProductPanel } from './product-panel';
import { VideoStageEntry } from './project-workspace';
import { ProductReferencePanel, RfqPanel } from './sales-panels';
import { WorkspacePanelSkeleton } from './workspace-loading-skeleton';
import { hasPermission } from '@/lib/authz';
import { getProjectContentCatalogDetail, listCrossProjectContentCandidates, listProjectContentCatalogEntries, listReadyProductContentSources } from '@/lib/content/store';
import { getProductVideoReadiness, listProductMediaAssets } from '@/lib/product/media-store';
import { getProjectProductCatalogDetail, listProjectProductCatalogEntries } from '@/lib/products';
import { listProjectDeliveryConfirmations, listProjectLeads, listProjectQuotations } from '@/lib/sales/closing-store';
import { listProjectRfqEntries } from '@/lib/sales/store';
import { listProjectPublicationData } from '@/lib/social/publication-store';
import { listProjectMarketingVideoEntries } from '@/lib/video/store';
import { listProjectEvidenceOptions } from '@/lib/workspace/access';
import { readWorkspaceModelSettings } from '@/lib/workspace/read-model';
import { listProjectReadyProductReferences } from '@/lib/workspace/store';

async function ProductMedia({ projectId, productId, canReview }: { projectId: string; productId: string; canReview: boolean }) {
  const [assets, assessment] = await Promise.all([listProductMediaAssets(productId), getProductVideoReadiness(productId)]);
  return <ProductMediaPanel projectId={projectId} productId={productId} assets={assets} assessment={assessment} canReview={canReview} />;
}
export async function ProjectStagePanel({ projectId, actorId, role, stage, selectedId }: { projectId: string; actorId: string; role: string | null | undefined; stage: string; selectedId?: string }) {
  switch (stage) {
    case 'product': {
      const [entries, detail, settings, evidenceOptions] = await Promise.all([listProjectProductCatalogEntries(projectId), selectedId ? getProjectProductCatalogDetail(projectId, selectedId) : null, readWorkspaceModelSettings(), listProjectEvidenceOptions(projectId, actorId)]);
      const canReview = hasPermission(role, 'product:review');
      return <div className="flex flex-col gap-6"><ProductPanel projectId={projectId} entries={entries} detail={detail} canReview={canReview} agentModelConfigs={settings} evidenceOptions={evidenceOptions} />{detail?.state === 'PRODUCT_READY' ? <Suspense fallback={<WorkspacePanelSkeleton label="正在加载产品素材" />}><ProductMedia projectId={projectId} productId={detail.id} canReview={canReview} /></Suspense> : null}</div>;
    }
    case 'content': {
      const [entries, products, copyCandidates, detail] = await Promise.all([listProjectContentCatalogEntries(projectId), listReadyProductContentSources(projectId), listCrossProjectContentCandidates(projectId, actorId), selectedId ? getProjectContentCatalogDetail(projectId, selectedId) : null]);
      return <ContentPanel projectId={projectId} entries={entries} products={products} copyCandidates={copyCandidates} detail={detail} canReview={hasPermission(role, 'content:review')} />;
    }
    case 'video': {
      const entries = await listProjectMarketingVideoEntries(projectId);
      return <VideoStageEntry projectId={projectId} count={entries.length} pendingReview={entries.filter((entry) => entry.state === 'VIDEO_REVIEW_REQUIRED').length} />;
    }
    case 'publication': return <PublicationPanel projectId={projectId} {...await listProjectPublicationData(projectId)} />;
    case 'rfq': {
      const [entries, leads, available, linked] = await Promise.all([listProjectRfqEntries(projectId), listProjectLeads(projectId, actorId), listReadyProductContentSources(), listProjectReadyProductReferences(projectId)]);
      return <div className="flex flex-col gap-6"><RfqPanel projectId={projectId} entries={entries} selectedId={selectedId} leads={leads} /><ProductReferencePanel projectId={projectId} available={available} linked={linked} /></div>;
    }
    case 'quotation': {
      const [entries, rfqs, products] = await Promise.all([listProjectQuotations(projectId), listProjectRfqEntries(projectId), listProjectReadyProductReferences(projectId)]);
      return <QuotationPanel projectId={projectId} entries={entries} rfqs={rfqs} products={products} canReview={hasPermission(role, 'quotation:review')} />;
    }
    case 'delivery': return <DeliveryPanel projectId={projectId} entries={await listProjectDeliveryConfirmations(projectId)} canReview={hasPermission(role, 'delivery:review')} />;
    case 'inbound':
    case 'follow-up':
    case 'opportunity': {
      const leads = await listProjectLeads(projectId, actorId);
      return <LeadPanel projectId={projectId} entries={stage === 'opportunity' ? leads.filter((entry) => entry.state === 'OPPORTUNITY') : leads} />;
    }
    default: throw new Error('Unsupported project stage');
  }
}
''')

write('app/workspace/[projectId]/page.tsx', '''import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { z } from 'zod';
import { ProjectMembersPanel } from '@/components/workspace/project-members-panel';
import { ProjectStagePanel } from '@/components/workspace/project-stage-panel';
import { ProjectStageTasks, ProjectWorkspace } from '@/components/workspace/project-workspace';
import { WorkspaceLoadingSkeleton, WorkspacePanelSkeleton } from '@/components/workspace/workspace-loading-skeleton';
import { requirePermission } from '@/lib/auth-guard';
import { listWorkspaceProjectMembers } from '@/lib/workspace/access';
import { readDefaultProjectStage, readWorkspaceProject, readWorkspaceTasks } from '@/lib/workspace/read-model';
import { projectStages, requestedProjectStage, type ProjectStage } from '@/lib/workspace/stages';

type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<{ panel?: string; item?: string }> };
async function Members({ projectId, actorId }: { projectId: string; actorId: string }) {
  return <ProjectMembersPanel projectId={projectId} currentUserId={actorId} members={await listWorkspaceProjectMembers(projectId, actorId)} />;
}
async function Tasks({ projectId, actorId, stage }: { projectId: string; actorId: string; stage: ProjectStage }) {
  return <ProjectStageTasks projectId={projectId} stage={stage} tasks={await readWorkspaceTasks(actorId, projectId)} />;
}
async function ProjectContent({ params, searchParams }: Props) {
  await connection();
  const [{ projectId }, query, session] = await Promise.all([params, searchParams, requirePermission('workspace:view')]);
  const project = await readWorkspaceProject(projectId, session.user.id);
  if (!project) notFound();
  const selectedId = z.uuid().safeParse(query.item).success ? query.item : undefined;
  const legacyTask = project.kind === 'sales' && query.panel === 'lead' && selectedId
    ? (await readWorkspaceTasks(session.user.id, projectId)).find((task) => task.id === selectedId) : undefined;
  const activeStage = requestedProjectStage(project.kind, query.panel, legacyTask?.taskType) ?? await readDefaultProjectStage(project, session.user.id);
  const stages = projectStages(project.kind);
  const stage = stages.find((candidate) => candidate.id === activeStage);
  if (!stage) notFound();
  return <ProjectWorkspace project={project} stages={stages} activeStage={activeStage}
    membersPanel={<Suspense fallback={<span className="text-sm text-muted-foreground">正在加载成员</span>}><Members projectId={projectId} actorId={session.user.id} /></Suspense>}
    tasksPanel={<Suspense key={`${projectId}:${activeStage}`} fallback={<WorkspacePanelSkeleton label={`正在加载${stage.label}待办`} />}><Tasks projectId={projectId} actorId={session.user.id} stage={stage} /></Suspense>}
    panel={<Suspense key={`${projectId}:${activeStage}:${selectedId ?? ''}`} fallback={<WorkspacePanelSkeleton label={`正在加载${stage.label}详情`} />}><ProjectStagePanel projectId={projectId} actorId={session.user.id} role={session.user.role} stage={activeStage} selectedId={selectedId} /></Suspense>}
  />;
}
export default function ProjectPage(props: Props) { return <Suspense fallback={<WorkspaceLoadingSkeleton project />}><ProjectContent {...props} /></Suspense>; }
''')

# Persisted layout data must refresh after business mutations, but not on ordinary navigation.
for path in (ROOT / 'lib/actions').glob('*.ts'):
    text = path.read_text().replace('revalidatePath("/workspace")', 'revalidatePath("/workspace", "layout")')
    if path.name == 'workspace.ts':
        text = text.replace('revalidatePath(`/workspace/${projectId}`);', 'revalidatePath(`/workspace/${projectId}`);\n    revalidatePath("/workspace", "layout");')
    path.write_text(text)
replace('scripts/validate_repository.py', "'revalidatePath(\"/workspace\")'", "'revalidatePath(\"/workspace\", \"layout\")'")

# Resolve the initial Biome errors without disabling recommended domains globally.
path = 'components/ui/breadcrumb.tsx'
text = read(path).replace('      role="link"\n', '').replace('      aria-disabled="true"\n', '')
write(path, text)
path = 'components/ui/field.tsx'
text = read(path).replace('uniqueErrors?.length == 1', 'uniqueErrors?.length === 1').replace('uniqueErrors.map((error, index)', 'uniqueErrors.map((error)').replace('<li key={index}>{error.message}</li>', '<li key={error.message}>{error.message}</li>')
text = text.replace('    <div\n      role="group"', '    // biome-ignore lint/a11y/useSemanticElements: This shadcn Field is a layout group inside FieldSet, not another fieldset.\n    <div\n      role="group"')
write(path, text)
path = 'components/ui/label.tsx'
text = read(path).replace('    <label', '    // biome-ignore lint/a11y/noLabelWithoutControl: The reusable primitive forwards htmlFor and children supplied by its caller.\n    <label', 1)
write(path, text)
path = 'components/ui/sidebar.tsx'
text = read(path).replace('[isMobile, setOpen, setOpenMobile]', '[isMobile, setOpen]').replace('[state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]', '[state, open, setOpen, isMobile, openMobile, toggleSidebar]')
write(path, text)
replace('components/workspace/inbound-routing-list.tsx', '<div className="mb-4 space-y-3" aria-label="待分流入站消息">', '<div role="region" className="mb-4 space-y-3" aria-label="待分流入站消息">')
replace('components/workspace/marketing-video-panel.tsx', '            <video\n', '            <video\n              muted\n')
path = 'components/workspace/product-panel.tsx'
text = read(path)
if '  useMemo,' not in text:
    text = text.replace('  useEffect,', '  useEffect,\n  useMemo,', 1)
text = text.replace('  const emptyAgent = {', '  const emptyAgent = useMemo(() => ({', 1)
text = text.replace('    hasUpload: false,\n  };', '    hasUpload: false,\n  }), [defaultConfig?.id, defaultConfig?.model]);', 1)
text = text.replace('  }, [form, router, state.status]);', '  }, [emptyAgent, initialChoice, form, router, state.status]);', 1)
write(path, text)

write('.nvmrc', '24')
package = json.loads(read('package.json'))
package['scripts']['test:workspace-navigation'] = 'tsx scripts/test-workspace-navigation.ts && node --conditions=react-server --import tsx scripts/test-workspace-queries.ts'
write('package.json', json.dumps(package, indent=2, ensure_ascii=False))
print('Applied shared layout, staged reads, per-request memoization, parallel queries, layout invalidation, and lint corrections.')
