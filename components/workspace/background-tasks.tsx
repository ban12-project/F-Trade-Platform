"use client";

import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/react/popover";
import { BellIcon, CheckCircle2Icon, ExternalLinkIcon, XCircleIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useWorkspaceDirtyState } from "./dirty-state";

export type BackgroundTaskKind =
  | "catalog"
  | "product-stream"
  | "video-render"
  | "video-ai-draft"
  | "inbox-sync"
  | "publication";

export type BackgroundTaskStatus = "running" | "success" | "error";

export type BackgroundTaskItem = {
  id: string;
  kind: BackgroundTaskKind;
  title: string;
  description?: string;
  status: BackgroundTaskStatus;
  href?: string;
  updatedAt: number;
};

export type BackgroundTaskPollResult =
  | { done: false; description?: string; href?: string }
  | {
      done: true;
      status: "success" | "error";
      title?: string;
      description?: string;
      href?: string;
    };

type StartTaskInput = {
  id: string;
  kind: BackgroundTaskKind;
  title: string;
  description?: string;
  href?: string;
  poller?: () => Promise<BackgroundTaskPollResult>;
  intervalMs?: number;
};

type BackgroundTasksContextValue = {
  tasks: BackgroundTaskItem[];
  startTask: (input: StartTaskInput) => void;
  finishTask: (
    id: string,
    result: {
      kind?: BackgroundTaskKind;
      status: "success" | "error";
      title: string;
      description?: string;
      href?: string;
    },
  ) => void;
  clearFinished: () => void;
};

const STORAGE_KEY = "ftrade-background-tasks-v1";

const fallbackContext: BackgroundTasksContextValue = {
  tasks: [],
  startTask: (input) => {
    toast.loading(input.title, { id: `bg-task-${input.id}`, description: input.description });
  },
  finishTask: (id, result) => {
    const fn = result.status === "success" ? toast.success : toast.error;
    fn(result.title, { id: `bg-task-${id}`, description: result.description });
  },
  clearFinished: () => {},
};

const BackgroundTasksContext = createContext<BackgroundTasksContextValue>(fallbackContext);

export function useBackgroundTasks() {
  return useContext(BackgroundTasksContext);
}

function readStoredTasks(): BackgroundTaskItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 12);
  } catch {
    return [];
  }
}

export function BackgroundTasksProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { requestNavigation } = useWorkspaceDirtyState();
  const [tasks, setTasks] = useState<BackgroundTaskItem[]>(readStoredTasks);
  const pollers = useRef(
    new Map<string, { timer: ReturnType<typeof setInterval>; inFlight: boolean }>(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, 12)));
    } catch {
      // Ignore storage quota errors in private browsing.
    }
  }, [tasks]);

  useEffect(() => {
    const active = pollers.current;
    return () => {
      for (const entry of active.values()) clearInterval(entry.timer);
      active.clear();
    };
  }, []);

  const stopPoller = useCallback((id: string) => {
    const existing = pollers.current.get(id);
    if (!existing) return;
    clearInterval(existing.timer);
    pollers.current.delete(id);
  }, []);

  const openHref = useCallback(
    (href: string) => {
      requestNavigation(() => {
        router.push(href);
      });
    },
    [requestNavigation, router],
  );

  const upsertTask = useCallback((item: BackgroundTaskItem) => {
    setTasks((current) => {
      const next = [item, ...current.filter((entry) => entry.id !== item.id)];
      return next.slice(0, 12);
    });
  }, []);

  const finishTask = useCallback(
    (
      id: string,
      result: {
        kind?: BackgroundTaskKind;
        status: "success" | "error";
        title: string;
        description?: string;
        href?: string;
      },
    ) => {
      stopPoller(id);
      setTasks((current) => {
        const previous = current.find((entry) => entry.id === id);
        const item: BackgroundTaskItem = {
          id,
          kind: result.kind ?? previous?.kind ?? "catalog",
          title: result.title,
          description: result.description,
          status: result.status,
          href: result.href ?? previous?.href,
          updatedAt: Date.now(),
        };
        return [item, ...current.filter((entry) => entry.id !== id)].slice(0, 12);
      });
      const actionHref = result.href;
      const notify = result.status === "success" ? toast.success : toast.error;
      notify(result.title, {
        id: `bg-task-${id}`,
        description: result.description,
        duration: 8000,
        action: actionHref ? { label: "查看", onClick: () => openHref(actionHref) } : undefined,
      });
      if (result.status === "success") router.refresh();
    },
    [openHref, router, stopPoller],
  );

  const startTask = useCallback(
    (input: StartTaskInput) => {
      const now = Date.now();
      upsertTask({
        id: input.id,
        kind: input.kind,
        title: input.title,
        description: input.description,
        status: "running",
        href: input.href,
        updatedAt: now,
      });

      toast.loading(input.title, {
        id: `bg-task-${input.id}`,
        description: input.description ?? "可离开当前页面，完成后会自动提醒。",
        duration: Number.POSITIVE_INFINITY,
        action: input.href
          ? { label: "打开", onClick: () => openHref(input.href as string) }
          : undefined,
      });

      stopPoller(input.id);
      if (!input.poller) return;

      const pollerFn = input.poller;
      const state = {
        inFlight: false,
        timer: setInterval(async () => {
          if (state.inFlight) return;
          state.inFlight = true;
          try {
            const outcome = await pollerFn();
            if (outcome.done) {
              finishTask(input.id, {
                kind: input.kind,
                status: outcome.status,
                title: outcome.title ?? input.title,
                description: outcome.description,
                href: outcome.href ?? input.href,
              });
            } else if (outcome.description || outcome.href) {
              setTasks((current) =>
                current.map((entry) =>
                  entry.id === input.id
                    ? {
                        ...entry,
                        description: outcome.description ?? entry.description,
                        href: outcome.href ?? entry.href,
                        updatedAt: Date.now(),
                      }
                    : entry,
                ),
              );
            }
          } catch {
            // Keep polling on transient read errors; the task finishes on next check or user inspection.
          } finally {
            state.inFlight = false;
          }
        }, input.intervalMs ?? 3000),
      };
      pollers.current.set(input.id, state);
    },
    [finishTask, openHref, stopPoller, upsertTask],
  );

  const clearFinished = useCallback(() => {
    setTasks((current) => current.filter((task) => task.status === "running"));
  }, []);

  const value = useMemo(
    () => ({ tasks, startTask, finishTask, clearFinished }),
    [clearFinished, finishTask, startTask, tasks],
  );

  return <BackgroundTasksContext value={value}>{children}</BackgroundTasksContext>;
}

export function BackgroundTasksIndicator() {
  const router = useRouter();
  const { requestNavigation } = useWorkspaceDirtyState();
  const { tasks, clearFinished } = useBackgroundTasks();
  const runningCount = tasks.filter((task) => task.status === "running").length;
  const hasFinished = tasks.some((task) => task.status !== "running");

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={runningCount ? `后台任务（${runningCount} 项进行中）` : "后台任务通知"}
        className={cn(
          buttonVariants({ variant: runningCount ? "secondary" : "ghost", size: "sm" }),
          "gap-1.5",
        )}
      >
        {runningCount ? <Spinner aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
        <span className="hidden sm:inline">任务</span>
        {tasks.length ? (
          <Badge variant={runningCount ? "default" : "outline"} className="px-1.5 py-0 text-[10px]">
            {runningCount || tasks.length}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="z-50 w-80 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      >
        <div className="flex items-center justify-between gap-2 pb-2">
          <PopoverTitle className="text-sm font-semibold">异步任务状态</PopoverTitle>
          <div className="flex items-center gap-1">
            {hasFinished ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearFinished}>
                清空已结束
              </Button>
            ) : null}
            <PopoverClose
              type="button"
              aria-label="关闭任务列表"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </PopoverClose>
          </div>
        </div>
        {tasks.length ? (
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto" aria-label="最近异步任务">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex flex-col gap-1 rounded-lg border border-border bg-background p-2.5 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    {task.status === "running" ? (
                      <Spinner aria-hidden="true" />
                    ) : task.status === "success" ? (
                      <CheckCircle2Icon
                        className="size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircleIcon
                        className="size-4 shrink-0 text-destructive"
                        aria-hidden="true"
                      />
                    )}
                    <span className="line-clamp-2">{task.title}</span>
                  </span>
                </div>
                {task.description ? (
                  <p className="text-xs text-muted-foreground">{task.description}</p>
                ) : null}
                {task.href ? (
                  <div className="pt-1">
                    <PopoverClose
                      type="button"
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "h-7 gap-1",
                      )}
                      onClick={() =>
                        requestNavigation(() => {
                          router.push(task.href as string);
                        })
                      }
                    >
                      查看详情
                      <ExternalLinkIcon className="size-3" aria-hidden="true" />
                    </PopoverClose>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground">
            暂无后台任务。提交目录解析、视频合成或收件箱同步后，可自由切换页面，进度会保留在此处。
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
