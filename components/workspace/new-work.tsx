"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  Suspense,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createWorkspaceProjectAction, type WorkspaceActionState } from "@/lib/actions/workspace";
import { createWorkspaceProjectSchema } from "@/lib/workspace/contracts";
import { workspaceCreateHref } from "@/lib/workspace/navigation";
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";
import { useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";

export type NewWorkIntent = "product" | "content" | "rfq";
const intents = [
  { id: "product", label: "录入产品" },
  { id: "content", label: "制作内容" },
  { id: "rfq", label: "记录询盘" },
] as const;
const NewWorkContext = createContext<{
  start: (intent: NewWorkIntent | null) => void;
  ready: boolean;
} | null>(null);
const ProjectDataContext = createContext<((projects: WorkspaceProjectSummary[]) => void) | null>(
  null,
);
export function NewWorkProjects({ projects }: { projects: WorkspaceProjectSummary[] }) {
  const load = useContext(ProjectDataContext);
  useEffect(() => {
    load?.(projects);
  }, [load, projects]);
  return null;
}
function NewWorkRouteReset() {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const context = useContext(NewWorkContext);
  const start = context?.start;
  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      start?.(null);
    }
  }, [pathname, start]);
  return null;
}
const initialState: WorkspaceActionState = { status: "idle", message: "" };
function NewProjectForm({
  kind,
  onCreated,
  onPending,
  onDirty,
}: {
  kind: "marketing" | "sales";
  onCreated: (id: string) => void;
  onPending: (pending: boolean) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const inputId = useId();
  const [state, action, pending] = useActionState(createWorkspaceProjectAction, initialState);
  const form = useForm<z.infer<typeof createWorkspaceProjectSchema>>({
    resolver: zodResolver(createWorkspaceProjectSchema),
    defaultValues: { kind, title: "" },
  });
  useEffect(() => {
    onPending(pending);
  }, [pending, onPending]);
  const dirty = form.formState.isDirty && state.status !== "success";
  useWorkspaceDirty("new-project", dirty);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (state.status === "success" && state.projectId) onCreated(state.projectId);
  }, [state, onCreated]);
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => {
        const data = new FormData();
        data.set("title", values.title);
        data.set("kind", values.kind);
        startTransition(() => action(data));
      })}
    >
      <FieldGroup>
        <Field data-invalid={!!form.formState.errors.title}>
          <FieldLabel htmlFor={inputId}>项目名称</FieldLabel>
          <Input
            id={inputId}
            {...form.register("title")}
            placeholder={kind === "marketing" ? "例如：离合器产品推广" : "例如：海外经销商询盘"}
            aria-invalid={!!form.formState.errors.title}
            aria-describedby={`${inputId}-error`}
          />
          <FieldDescription>项目决定资料归属和成员权限，可在项目中管理成员。</FieldDescription>
          <FieldError id={`${inputId}-error`}>{form.formState.errors.title?.message}</FieldError>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "正在创建…" : "创建项目并开始"}
        </Button>
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}
      </FieldGroup>
    </form>
  );
}
function NewWorkDialog({
  intent,
  projects,
  onClose,
  onStart,
}: {
  intent: NewWorkIntent;
  projects: WorkspaceProjectSummary[];
  onClose: () => void;
  onStart: (projectId: string, intent: NewWorkIntent) => void;
}) {
  const id = useId();
  const { requestNavigation } = useWorkspaceDirtyState();
  const params = useParams();
  const [creating, setCreating] = useState(false);
  const [ownDirty, setOwnDirty] = useState(false);
  function changeSelection(action: () => void) {
    if (ownDirty) requestNavigation(action);
    else action();
  }
  const [selectedIntent, setIntent] = useState(intent);
  const kind = selectedIntent === "rfq" ? "sales" : "marketing";
  const available = projects.filter(
    (project) =>
      project.kind === kind && project.status === "active" && project.memberRole !== "viewer",
  );
  const [projectId, setProjectId] = useState(
    available.find((project) => project.id === params.projectId)?.id ?? available[0]?.id ?? "new",
  );
  const selected =
    projectId === "new" || available.some((project) => project.id === projectId)
      ? projectId
      : (available[0]?.id ?? "new");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !creating) changeSelection(onClose);
      }}
    >
      <DialogContent showCloseButton={!creating} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>开始新工作</DialogTitle>
          <DialogDescription>先选要做的事，再确认资料属于哪个项目。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel id={`${id}-intent`}>这次要做什么</FieldLabel>
            <ToggleGroup
              disabled={creating}
              aria-labelledby={`${id}-intent`}
              variant="outline"
              spacing={1}
              value={[selectedIntent]}
              onValueChange={(values) => {
                if (values[0]) {
                  const nextIntent = values[0] as NewWorkIntent;
                  changeSelection(() => {
                    setIntent(nextIntent);
                    setProjectId("");
                  });
                }
              }}
            >
              {intents.map((item) => (
                <ToggleGroupItem key={item.id} value={item.id}>
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-project`}>归属项目</FieldLabel>
            <NativeSelect
              id={`${id}-project`}
              className="w-full"
              value={selected}
              disabled={creating}
              onChange={(event) => {
                const nextProject = event.target.value;
                changeSelection(() => setProjectId(nextProject));
              }}
            >
              {available.map((project) => (
                <NativeSelectOption key={project.id} value={project.id}>
                  {project.title}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value="new">
                创建新的{kind === "marketing" ? "营销" : "销售"}项目
              </NativeSelectOption>
            </NativeSelect>
            <FieldDescription>
              {available.length
                ? "可以继续使用已有项目，无需每次新建。"
                : "目前没有可编辑的同类项目，先创建一个归属范围。"}
            </FieldDescription>
          </Field>
          {selected === "new" ? (
            <NewProjectForm
              key={kind}
              kind={kind}
              onPending={setCreating}
              onDirty={setOwnDirty}
              onCreated={(id) => onStart(id, selectedIntent)}
            />
          ) : (
            <Button onClick={() => onStart(selected, selectedIntent)}>
              在此项目开始
              {selectedIntent === "rfq"
                ? "记录询盘"
                : selectedIntent === "content"
                  ? "制作内容"
                  : "录入产品"}
            </Button>
          )}
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
export function NewWorkProvider({
  children,
  projects,
  basePath = "/workspace",
}: {
  children: ReactNode;
  projects?: WorkspaceProjectSummary[];
  basePath?: string;
}) {
  const router = useRouter();
  const { requestNavigation } = useWorkspaceDirtyState();
  const [loadedProjects, setProjects] = useState(projects);
  const [intent, setIntent] = useState<NewWorkIntent | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (!destination || intent) return;
    setDestination(null);
    requestNavigation(() => router.push(destination));
  }, [destination, intent, requestNavigation, router]);
  return (
    <ProjectDataContext value={setProjects}>
      <NewWorkContext value={{ start: setIntent, ready: loadedProjects !== undefined }}>
        <Suspense fallback={null}>
          <NewWorkRouteReset />
        </Suspense>
        {children}
        {intent ? (
          <NewWorkDialog
            intent={intent}
            projects={loadedProjects ?? []}
            onClose={() => setIntent(null)}
            onStart={(projectId, intent) => {
              setIntent(null);
              setDestination(
                basePath === "/workspace"
                  ? workspaceCreateHref(projectId, intent)
                  : `${basePath}/${projectId}?panel=${intent}`,
              );
            }}
          />
        ) : null}
      </NewWorkContext>
    </ProjectDataContext>
  );
}
export function NewWorkButton({
  intent = "product",
  children = "开始新工作",
  variant = "default",
  onOpen,
}: {
  intent?: NewWorkIntent;
  children?: ReactNode;
  variant?: "default" | "outline" | "secondary";
  onOpen?: () => void;
}) {
  const context = useContext(NewWorkContext);
  return (
    <Button
      className="min-h-11"
      variant={variant}
      onClick={() => {
        onOpen?.();
        context?.start(intent);
      }}
      disabled={!context?.ready}
    >
      <PlusIcon data-icon="inline-start" />
      {children}
    </Button>
  );
}
