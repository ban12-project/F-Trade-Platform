"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
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
  useSyncExternalStore,
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
import { type NewWorkIntent, workspaceCreationRestriction } from "@/lib/workspace/new-work";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";
import { useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";

export type { NewWorkIntent } from "@/lib/workspace/new-work";

const intents = [
  { id: "product", label: "录入产品" },
  { id: "content", label: "制作内容" },
  { id: "rfq", label: "记录询盘" },
  { id: "video", label: "制作视频" },
] as const;
const NewWorkContext = createContext<{
  start: (intent: NewWorkIntent | null, projectId?: string, returnTo?: string) => void;
  projects: WorkspaceProjectSummary[];
  ready: boolean;
  dialogId: string;
  open: boolean;
} | null>(null);
export function useNewWork() {
  return useContext(NewWorkContext);
}
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
const subscribeToHydration = () => () => {};
const clientHydrationSnapshot = () => true;
const serverHydrationSnapshot = () => false;
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
            required
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
  dialogId,
}: {
  intent: NewWorkIntent | null;
  dialogId: string;
  projects: WorkspaceProjectSummary[];
  onClose: () => void;
  onStart: (projectId: string, intent: NewWorkIntent) => void;
}) {
  const { requestNavigation } = useWorkspaceDirtyState();
  const [creating, setCreating] = useState(false);
  const [ownDirty, setOwnDirty] = useState(false);
  function changeSelection(action: () => void) {
    if (ownDirty) requestNavigation(action);
    else action();
  }
  return (
    <Dialog
      open={Boolean(intent)}
      onOpenChange={(open) => {
        if (!open && !creating) {
          changeSelection(() => {
            setOwnDirty(false);
            setCreating(false);
            onClose();
          });
        }
      }}
    >
      <DialogContent
        id={dialogId}
        showCloseButton={!creating}
        className="max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>开始新工作</DialogTitle>
          <DialogDescription>先选要做的事，再确认资料属于哪个项目。</DialogDescription>
        </DialogHeader>
        {intent ? (
          <NewWorkDialogBody
            intent={intent}
            projects={projects}
            creating={creating}
            changeSelection={changeSelection}
            onPending={setCreating}
            onDirty={setOwnDirty}
            onStart={onStart}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewWorkDialogBody({
  intent,
  projects,
  creating,
  changeSelection,
  onPending,
  onDirty,
  onStart,
}: {
  intent: NewWorkIntent;
  projects: WorkspaceProjectSummary[];
  creating: boolean;
  changeSelection: (action: () => void) => void;
  onPending: (pending: boolean) => void;
  onDirty: (dirty: boolean) => void;
  onStart: (projectId: string, intent: NewWorkIntent) => void;
}) {
  const id = useId();
  const [selectedIntent, setIntent] = useState(intent);
  const kind = selectedIntent === "rfq" ? "sales" : "marketing";
  const available = projects.filter(
    (project) => !workspaceCreationRestriction(project, selectedIntent),
  );
  const [projectId, setProjectId] = useState("");
  const selected =
    projectId === "new" || available.some((project) => project.id === projectId) ? projectId : "";
  useEffect(() => {
    return () => {
      onDirty(false);
      onPending(false);
    };
  }, [onDirty, onPending]);
  return (
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
          <NativeSelectOption value="">请选择归属项目</NativeSelectOption>
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
        {available.length === 1 && !selected ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={creating}
            onClick={() => changeSelection(() => setProjectId(available[0].id))}
          >
            一键选中唯一可用项目：{available[0].title}
          </Button>
        ) : null}
      </Field>
      {selected === "new" ? (
        <NewProjectForm
          key={kind}
          kind={kind}
          onPending={onPending}
          onDirty={onDirty}
          onCreated={(id) => onStart(id, selectedIntent)}
        />
      ) : (
        <Button disabled={!selected} onClick={() => onStart(selected, selectedIntent)}>
          在此项目开始
          {intents.find((item) => item.id === selectedIntent)?.label}
        </Button>
      )}
    </FieldGroup>
  );
}
export function NewWorkProvider({
  children,
  projects,
}: {
  children: ReactNode;
  projects?: WorkspaceProjectSummary[];
  basePath?: string;
}) {
  const router = useRouter();
  const { requestNavigation } = useWorkspaceDirtyState();
  const dialogId = useId();
  const [loadedProjects, setProjects] = useState(projects);
  const [intent, setIntent] = useState<NewWorkIntent | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | undefined>();
  useEffect(() => {
    if (!destination || intent) return;
    setDestination(null);
    requestNavigation(() => router.push(destination));
  }, [destination, intent, requestNavigation, router]);
  return (
    <ProjectDataContext value={setProjects}>
      <NewWorkContext
        value={{
          projects: loadedProjects ?? [],
          start: (nextIntent, projectId, origin) => {
            if (!nextIntent) {
              setIntent(null);
              return;
            }
            if (projectId) {
              const project = loadedProjects?.find((project) => project.id === projectId);
              if (workspaceCreationRestriction(project, nextIntent)) return;
              setDestination(workspaceCreateHref(projectId, nextIntent, undefined, origin));
              return;
            }
            setReturnTo(origin);
            setIntent(nextIntent);
          },
          ready: loadedProjects !== undefined,
          dialogId,
          open: !!intent,
        }}
      >
        <Suspense fallback={null}>
          <NewWorkRouteReset />
        </Suspense>
        {children}
        <NewWorkDialog
          intent={intent}
          dialogId={dialogId}
          projects={loadedProjects ?? []}
          onClose={() => setIntent(null)}
          onStart={(projectId, nextIntent) => {
            setIntent(null);
            setDestination(workspaceCreateHref(projectId, nextIntent, undefined, returnTo));
          }}
        />
      </NewWorkContext>
    </ProjectDataContext>
  );
}
export function NewWorkButton({
  intent = "product",
  children = "开始新工作",
  variant = "default",
  onOpen,
  projectId,
  returnTo,
  "data-guide": guideTarget,
}: {
  intent?: NewWorkIntent;
  children?: ReactNode;
  variant?: "default" | "outline" | "secondary";
  onOpen?: () => void;
  projectId?: string;
  returnTo?: string;
  "data-guide"?: "new-work";
}) {
  const context = useContext(NewWorkContext);
  // A provider can hydrate before this trigger's Suspense boundary. Match this
  // button's server snapshot until its own event handlers are attached.
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientHydrationSnapshot,
    serverHydrationSnapshot,
  );
  const selectedProject = context?.projects.find((project) => project.id === projectId);
  const knownProjectReady = !projectId || !workspaceCreationRestriction(selectedProject, intent);
  return (
    <Button
      className="min-h-11"
      data-guide={guideTarget}
      aria-haspopup={projectId ? undefined : "dialog"}
      aria-expanded={context?.open ?? false}
      aria-controls={context?.open ? context.dialogId : undefined}
      variant={variant}
      onClick={() => {
        onOpen?.();
        context?.start(intent, projectId, returnTo);
      }}
      disabled={!hydrated || !context?.ready || !knownProjectReady}
    >
      <PlusIcon data-icon="inline-start" />
      {children}
    </Button>
  );
}
