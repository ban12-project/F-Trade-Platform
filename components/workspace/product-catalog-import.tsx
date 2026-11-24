"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getLatestProductCatalogAction,
  getProductCatalogAction,
  intakeProductCatalogAction,
  retryProductCatalogAction,
  selectProductCatalogAction,
} from "@/lib/actions/product-catalog";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import {
  type CatalogActionResult,
  type CatalogFailureCode,
  type CatalogImportView,
  type CatalogSelection,
  catalogSelectionSchema,
  maximumCatalogBatchRecords,
} from "@/lib/product/catalog-import-contracts";
import { documentUploadFormSchema } from "@/lib/product/document-upload-contracts";
import { uploadProductDocument } from "@/lib/product/upload-document-client";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useBackgroundTasks } from "./background-tasks";
import { useWorkspaceDirty } from "./dirty-state";
import { FileDropzone } from "./file-dropzone";
import { MarkdownContent } from "./markdown-content";
import { WorkspaceLink as Link } from "./workspace-link";

const failures: Record<CatalogFailureCode, string> = {
  SOURCE_UNAVAILABLE: "无法读取或核验原件，请重新上传。",
  PREPROCESS_FAILED: "目录解析失败，可重试或更换可提取文字的文件。",
  MODEL_FAILED: "抽取未通过，请检查或切换模型配置后重试。",
  MODEL_CONFIG_UNAVAILABLE: "模型配置不可用，请在工作区设置中检查配置。",
  MODEL_OUTPUT_REJECTED: "模型输出未通过格式或来源校验，未保存草稿。可以重试或更换模型。",
  ACCESS_REVOKED: "登录或项目权限已失效，请恢复权限后重试。",
  DISPATCH_FAILED: "后台任务未能启动，请重试。",
  ATTEMPT_EXPIRED: "任务已超时，可以安全重试。",
};
const candidateLabels = {
  available: "待选择",
  queued: "排队中",
  running: "抽取中",
  completed: "草稿待审核",
  failed: "失败",
};
function isWorking(view: CatalogImportView | null) {
  return (
    view &&
    (view.status === "queued" ||
      view.status === "parsing" ||
      view.candidates.some(
        (candidate) => candidate.status === "queued" || candidate.status === "running",
      ))
  );
}

export function ProductCatalogImport({
  projectId,
  modelConfigs,
  source,
  onDraftDirty,
  onBusyChange,
}: {
  projectId: string;
  modelConfigs: ProductAgentModelSettings[];
  source?: { file?: File; clear: () => void };
  onDraftDirty?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const { startTask } = useBackgroundTasks();
  const [view, setView] = useState<CatalogImportView | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const restoreFocus = useRef(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [standaloneFiles, setStandaloneFiles] = useState<File[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const uploadAttempt = useRef<{ controller: AbortController; dispatched: boolean } | null>(null);
  useEffect(
    () => () => {
      uploadAttempt.current?.controller.abort();
      uploadAttempt.current = null;
    },
    [],
  );
  const [error, setError] = useState("");
  const [progressError, setProgressError] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");
  useEffect(() => {
    onBusyChange?.(pending);
    return () => onBusyChange?.(false);
  }, [pending, onBusyChange]);
  const fileRef = useRef<HTMLInputElement>(null);
  const usable = modelConfigs.filter(
    (config) => config.apiKeyConfigured || config.authTokenConfigured,
  );
  const defaultConfig = usable.find((config) => config.isDefault) ?? usable[0];
  const choices = usable.flatMap((config) =>
    Array.from(new Set([config.model, ...config.discoveredModels])).map((model) => ({
      value: JSON.stringify([config.id, model]),
      configId: config.id,
      model,
      label: `${config.name} · ${model}`,
    })),
  );
  const uploadForm = useForm<z.infer<typeof documentUploadFormSchema>>({
    resolver: zodResolver(documentUploadFormSchema),
  });
  const selection = useForm<CatalogSelection>({
    resolver: zodResolver(catalogSelectionSchema),
    defaultValues: {
      projectId,
      importId: "",
      candidateIds: [],
      modelConfigId: defaultConfig?.id ?? "",
      model: defaultConfig?.model ?? "",
    },
  });
  const sourceFile = source?.file;
  const hasSharedSource = source !== undefined;
  useEffect(() => {
    if (sourceFile) uploadForm.setValue("document", sourceFile);
    else if (hasSharedSource) uploadForm.reset();
  }, [sourceFile, hasSharedSource, uploadForm]);
  const dirty = selection.formState.isDirty;
  useWorkspaceDirty("catalog-selection", dirty);
  useEffect(() => {
    onDraftDirty?.(dirty);
    return () => onDraftDirty?.(false);
  }, [dirty, onDraftDirty]);
  const selected = useWatch({ control: selection.control, name: "candidateIds" });
  const modelConfigId = useWatch({ control: selection.control, name: "modelConfigId" });
  const model = useWatch({ control: selection.control, name: "model" });
  const working = Boolean(isWorking(view));

  function trackCatalogBackgroundTask(importId: string, mode: "parse" | "extract") {
    const returnHref = `/workspace/products?project=${projectId}&method=catalog`;
    startTask({
      id: `catalog-${importId}`,
      kind: "catalog",
      title: mode === "parse" ? "目录正在后台解析" : "AI 正在批量抽取目录产品",
      description: "可以离开当前页面，完成后会自动通知。",
      href: returnHref,
      intervalMs: 3000,
      poller: async () => {
        const res = await getProductCatalogAction({ projectId, importId });
        if (res.status === "error") {
          return { done: false };
        }
        const nextView = res.view;
        if (isWorking(nextView)) {
          const doneCount = nextView.candidates.filter((c) => c.status === "completed").length;
          return {
            done: false,
            description:
              nextView.status === "parsing" || nextView.status === "queued"
                ? "正在扫描目录页与表格结构…"
                : `已完成 ${doneCount} / ${nextView.candidates.length} 条记录处理`,
          };
        }
        if (nextView.status === "failed") {
          return {
            done: true,
            status: "error",
            title: "目录任务未能完成",
            description: nextView.failureCode ? failures[nextView.failureCode] : "请进入查看详情。",
            href: returnHref,
          };
        }
        const draftCount = nextView.candidates.filter((c) => c.status === "completed").length;
        return {
          done: true,
          status: "success",
          title: mode === "parse" ? "目录解析完成" : "目录产品抽取完成",
          description:
            mode === "parse"
              ? `已识别 ${nextView.candidates.length} 条可选择的产品记录`
              : `已生成 ${draftCount} 条待人工审核草稿`,
          href: returnHref,
        };
      },
    });
  }

  useEffect(() => {
    if (view?.status !== "ready") return;
    const eligible = new Set(
      view.candidates
        .filter((candidate) => candidate.status === "available" || candidate.status === "failed")
        .map((candidate) => candidate.id),
    );
    const current = selection.getValues("candidateIds");
    const retained = current.filter((id) => eligible.has(id));
    if (retained.length === current.length) return;
    selection.setValue("candidateIds", retained, { shouldDirty: true });
    setSelectionNotice(
      `目录状态已更新，已从选择中移除 ${current.length - retained.length} 条当前不可生成的记录。`,
    );
  }, [view, selection]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter intentionally restarts this cancellable read.
  useEffect(() => {
    let cancelled = false;
    setRestoring(true);
    void getLatestProductCatalogAction(projectId)
      .then((result) => {
        if (cancelled) return;
        if (result.status === "success") {
          setView(result.view);
          setRestoreFailed(false);
          setError("");
          setProgressError("");
        } else {
          setRestoreFailed(true);
          setError(result.message);
        }
        setRestoring(false);
      })
      .catch(() => {
        if (!cancelled) {
          setRestoreFailed(true);
          setError("无法恢复目录任务，请重试读取已有任务。");
          setRestoring(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, restoreAttempt]);

  useEffect(() => {
    if (!view || !working || pending) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void getProductCatalogAction({ projectId, importId: view.id })
        .then((result) => {
          if (cancelled) return;
          if (result.status === "success") {
            setView(result.view);
            setProgressError("");
            if (!isWorking(result.view)) router.refresh();
          } else setProgressError(result.message);
        })
        .catch(() => {
          if (!cancelled) setProgressError("进度读取失败，请点击刷新进度。");
        });
    }, 2_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, working, pending, projectId, router]);

  useEffect(() => {
    if (!restoreFocus.current || restoring || restoreFailed) return;
    restoreFocus.current = false;
    if (view) progressRef.current?.focus();
    else uploadButtonRef.current?.focus();
  }, [restoring, restoreFailed, view]);

  function accept(result: CatalogActionResult) {
    if (result.status === "error") {
      setError(result.message);
      return false;
    }
    setView(result.view);
    setError("");
    setProgressError("");
    return true;
  }

  async function upload(values: z.infer<typeof documentUploadFormSchema>) {
    if (pending || restoring || restoreFailed || working || uploadAttempt.current) return;
    const active = { controller: new AbortController(), dispatched: false };
    uploadAttempt.current = active;
    setPending(true);
    setSelectionNotice("");
    setUploading(true);
    setError("");
    try {
      const receiptId = await uploadProductDocument(
        values.document,
        projectId,
        "agent",
        active.controller.signal,
      );
      active.controller.signal.throwIfAborted();
      active.dispatched = true;
      setUploading(false);
      const result = await intakeProductCatalogAction({ projectId, receiptId });
      if (uploadAttempt.current !== active) return;
      if (accept(result)) {
        uploadForm.reset();
        source?.clear();
        setStandaloneFiles([]);
        selection.reset({ ...selection.getValues(), candidateIds: [] });
        if (fileRef.current) fileRef.current.value = "";
        if (result.status === "success" && result.view && isWorking(result.view)) {
          trackCatalogBackgroundTask(result.view.id, "parse");
        }
      }
    } catch {
      if (uploadAttempt.current === active) {
        if (active.dispatched) {
          setRestoreFailed(true);
          setError("无法确认目录任务是否已提交。请先读取已有任务，再决定是否重新上传。");
        } else {
          setError("上传失败，请检查文件大小、网络及项目权限后重试。");
        }
      }
    } finally {
      if (uploadAttempt.current === active) {
        uploadAttempt.current = null;
        setUploading(false);
        setPending(false);
      }
    }
  }

  function stopUpload() {
    const active = uploadAttempt.current;
    if (!active || active.dispatched) return;
    active.controller.abort();
    uploadAttempt.current = null;
    setUploading(false);
    setPending(false);
    setError("已停止上传，未创建目录任务。文件选择已保留，可重新尝试。");
  }

  async function submit(values: CatalogSelection) {
    setPending(true);
    setSelectionNotice("");
    setError("");
    try {
      const result = await selectProductCatalogAction(values);
      if (accept(result)) {
        selection.reset({ ...values, candidateIds: [] });
        if (result.status === "success" && result.view && isWorking(result.view)) {
          trackCatalogBackgroundTask(result.view.id, "extract");
        }
      }
    } catch {
      setError("无法提交抽取任务，请重试。");
    } finally {
      setPending(false);
    }
  }

  async function update(retry: boolean) {
    if (!view) return;
    setPending(true);
    try {
      const input = { projectId, importId: view.id };
      const result = await (retry
        ? retryProductCatalogAction(input)
        : getProductCatalogAction(input));
      if (retry) {
        if (
          accept(result) &&
          result.status === "success" &&
          result.view &&
          isWorking(result.view)
        ) {
          trackCatalogBackgroundTask(result.view.id, "parse");
        }
      } else if (result.status === "error") setProgressError(result.message);
      else {
        setView(result.view);
        setProgressError("");
      }
    } catch {
      if (retry) setError("无法更新目录任务，请重试。");
      else setProgressError("进度读取失败，请点击刷新进度。");
    } finally {
      setPending(false);
    }
  }

  const available =
    view?.candidates.filter(
      (candidate) => candidate.status === "available" || candidate.status === "failed",
    ) ?? [];

  const filteredCandidates = useMemo(() => {
    const candidates = view?.candidates ?? [];
    const query = candidateQuery.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter((candidate) => {
      const location = `${candidate.physicalPage ? `第 ${candidate.physicalPage} 页` : ""} 第 ${candidate.recordLine} 行`;
      const statusText = candidateLabels[candidate.status];
      return `${candidate.identifier} ${location} ${statusText}`.toLowerCase().includes(query);
    });
  }, [candidateQuery, view?.candidates]);

  const catalogMarkdown = useMemo(() => {
    if (!view) return "";
    const completedCount = view.candidates.filter((c) => c.status === "completed").length;
    const runningCount = view.candidates.filter(
      (c) => c.status === "queued" || c.status === "running",
    ).length;
    const failedCount = view.candidates.filter((c) => c.status === "failed").length;
    const lines = [
      "## 目录处理实时详情",
      "",
      `- **任务状态**：${view.status === "ready" ? "候选目录就绪" : view.status === "failed" ? "解析失败" : "正在解析目录"}`,
      `- **识别候选**：${view.candidates.length} 条（已完成草稿 **${completedCount}** · 处理中 **${runningCount}** · 失败 **${failedCount}**）`,
      ...(view.failureCode ? [`- **错误原因**：${failures[view.failureCode]}`] : []),
      "",
      "| 目录编号 | 来源位置 | 状态 | 备注 |",
      "| --- | --- | --- | --- |",
      ...view.candidates.slice(0, 60).map((candidate) => {
        const location = `${candidate.physicalPage ? `第 ${candidate.physicalPage} 页 · ` : ""}第 ${candidate.recordLine} 行`;
        const note = candidate.failureCode
          ? failures[candidate.failureCode]
          : candidate.productId
            ? "草稿已生成，点击表格「查看草稿」进入核实"
            : "—";
        return `| \`${candidate.identifier.replace(/\|/g, "\\|")}\` | ${location} | ${candidateLabels[candidate.status]} | ${note} |`;
      }),
      ...(view.candidates.length > 60
        ? ["", `> 仅展示前 60 条详情（共 ${view.candidates.length} 条），可用表格筛选框搜索。`]
        : []),
    ];
    return lines.join("\n");
  }, [view]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>目录批量导入</CardTitle>
        <CardDescription>
          上传目录后搜索并选择记录，每批最多 20 条。后台抽取时可自由切换页面，完成后将自动通知。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form aria-busy={pending} onSubmit={uploadForm.handleSubmit(upload)}>
          <FieldGroup>
            <Field data-invalid={Boolean(uploadForm.formState.errors.document)}>
              <FieldLabel htmlFor="catalog-document">产品目录文件</FieldLabel>
              {!source ? (
                <FileDropzone
                  id="catalog-document"
                  inputRef={fileRef}
                  accept=".pdf,.csv,.xls,.xlsx"
                  disabled={pending || restoring || restoreFailed || working}
                  invalid={Boolean(uploadForm.formState.errors.document)}
                  files={standaloneFiles}
                  emptyTitle="拖拽产品目录（PDF / CSV / Excel）到这里"
                  emptyDescription="最多 25 MB，解析进度在刷新或切换页面后自动恢复"
                  onFilesChange={(files) => {
                    setStandaloneFiles(files);
                    const file = files[0];
                    if (file)
                      uploadForm.setValue("document", file, {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                    else uploadForm.resetField("document");
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {sourceFile
                    ? `已就绪目录文件：${sourceFile.name}`
                    : "请先在上方选择产品目录文件。"}
                </p>
              )}
              <FieldDescription>
                支持 PDF、CSV 和 Excel，最大 25 MB。解析进度可在刷新或切换页面后恢复。
              </FieldDescription>
              <FieldError errors={[uploadForm.formState.errors.document]} />
            </Field>
            <Button
              ref={uploadButtonRef}
              type="submit"
              disabled={pending || restoring || restoreFailed || working}
            >
              {pending ? "提交中…" : "上传并解析目录"}
            </Button>
            {uploading && (
              <Button type="button" variant="outline" onClick={stopUpload}>
                停止上传
              </Button>
            )}
          </FieldGroup>
        </form>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {progressError && (
          <Alert>
            <AlertDescription>
              <p>{progressError}</p>
              <p>当前显示上次读取的目录进度，请刷新后再核对。</p>
            </AlertDescription>
          </Alert>
        )}
        {restoreFailed && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              尚未确认是否有已提交的目录任务。请先恢复读取，避免重复上传；所选文件会保留。
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={restoring}
              onClick={() => {
                restoreFocus.current = true;
                setRestoreAttempt((attempt) => attempt + 1);
              }}
            >
              重试读取已有任务
            </Button>
          </div>
        )}
        {restoring && <p role="status">正在恢复目录任务…</p>}
        {view && (
          <>
            <div
              ref={progressRef}
              tabIndex={-1}
              id="catalog-progress"
              className="flex flex-wrap items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              role="status"
            >
              <Badge variant="secondary">
                {view.status === "ready"
                  ? `${view.candidates.length} 条候选`
                  : view.status === "failed"
                    ? "解析失败"
                    : "正在解析目录"}
              </Badge>
              <Badge variant="outline">
                {view.candidates.filter((candidate) => candidate.status === "completed").length}{" "}
                条草稿
              </Badge>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void update(false)}
              >
                刷新进度
              </Button>
              <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
                  <EyeIcon data-icon="inline-start" />
                  查看 AI 处理详情
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>目录 AI 处理实时详情</DialogTitle>
                    <DialogDescription>
                      使用 Streamdown 实时渲染目录解析进度与每条候选记录的来源校验结果。
                    </DialogDescription>
                  </DialogHeader>
                  <div className="max-h-[65dvh] overflow-y-auto rounded-lg border bg-background p-4">
                    <MarkdownContent isAnimating={working}>{catalogMarkdown}</MarkdownContent>
                  </div>
                </DialogContent>
              </Dialog>
              {view.status === "failed" && (
                <Button size="sm" disabled={pending} onClick={() => void update(true)}>
                  重试解析
                </Button>
              )}
            </div>
            {view.failureCode && (
              <Alert>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span>{failures[view.failureCode]}</span>
                  {(view.failureCode === "MODEL_FAILED" ||
                    view.failureCode === "MODEL_CONFIG_UNAVAILABLE" ||
                    view.failureCode === "MODEL_OUTPUT_REJECTED") && (
                    <Link href="/workspace/settings?section=agent" className="underline">
                      去切换默认模型
                    </Link>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {view.status === "ready" &&
              (view.candidates.length ? (
                <form
                  onSubmit={(event) => {
                    selection.setValue("importId", view.id);
                    void selection.handleSubmit(submit)(event);
                  }}
                >
                  <FieldGroup>
                    <Collapsible>
                      <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
                        高级设置：抽取模型
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-4">
                        <Field
                          data-invalid={Boolean(
                            selection.formState.errors.modelConfigId ||
                              selection.formState.errors.model,
                          )}
                        >
                          <FieldLabel htmlFor="catalog-model">抽取模型</FieldLabel>
                          <NativeSelect
                            id="catalog-model"
                            value={JSON.stringify([modelConfigId, model])}
                            disabled={pending || !choices.length}
                            aria-invalid={Boolean(
                              selection.formState.errors.modelConfigId ||
                                selection.formState.errors.model,
                            )}
                            onChange={(event) => {
                              const choice = choices.find(
                                (item) => item.value === event.target.value,
                              );
                              if (choice) {
                                selection.setValue("modelConfigId", choice.configId, {
                                  shouldValidate: true,
                                  shouldDirty: true,
                                });
                                selection.setValue("model", choice.model, {
                                  shouldValidate: true,
                                  shouldDirty: true,
                                });
                              }
                            }}
                          >
                            {!choices.length && (
                              <NativeSelectOption value={JSON.stringify(["", ""])}>
                                请先在工作区设置配置模型
                              </NativeSelectOption>
                            )}
                            {choices.map((choice) => (
                              <NativeSelectOption key={choice.value} value={choice.value}>
                                {choice.label}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                          <FieldError
                            errors={[
                              selection.formState.errors.modelConfigId,
                              selection.formState.errors.model,
                            ]}
                          />
                        </Field>
                      </CollapsibleContent>
                    </Collapsible>
                    <FieldSet>
                      <FieldLegend id="catalog-selection-heading">
                        选择目录记录（已选 {selected.length}/{maximumCatalogBatchRecords}）
                      </FieldLegend>
                      <FieldDescription>
                        相同编号的不同页记录须分别核对。失败项可再次选择，已完成草稿不会重复生成。
                      </FieldDescription>
                      {selectionNotice && (
                        <p role="status" className="text-sm text-muted-foreground">
                          {selectionNotice}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-52 flex-1">
                          <SearchIcon
                            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <Input
                            type="search"
                            aria-label="筛选目录候选记录"
                            placeholder="按编号、页码或状态筛选…"
                            value={candidateQuery}
                            onChange={(event) => setCandidateQuery(event.target.value)}
                            className="pl-8"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending || !available.length}
                          onClick={() =>
                            selection.setValue(
                              "candidateIds",
                              available
                                .slice(0, maximumCatalogBatchRecords)
                                .map((candidate) => candidate.id),
                              { shouldValidate: true, shouldDirty: true },
                            )
                          }
                        >
                          选择前 20 条可用记录
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={pending || !selected.length}
                          onClick={() =>
                            selection.setValue("candidateIds", [], {
                              shouldValidate: true,
                              shouldDirty: true,
                            })
                          }
                        >
                          清空选择
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            pending || !available.some((candidate) => candidate.status === "failed")
                          }
                          onClick={() =>
                            selection.setValue(
                              "candidateIds",
                              available
                                .filter((candidate) => candidate.status === "failed")
                                .slice(0, maximumCatalogBatchRecords)
                                .map((candidate) => candidate.id),
                              { shouldValidate: true, shouldDirty: true },
                            )
                          }
                        >
                          选择失败记录
                        </Button>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>选择</TableHead>
                            <TableHead>目录编号</TableHead>
                            <TableHead>来源位置</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead>草稿</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredCandidates.map((candidate) => (
                            <TableRow key={candidate.id}>
                              <TableCell>
                                <Checkbox
                                  aria-label={`选择 ${candidate.identifier}，${candidate.physicalPage ? `第 ${candidate.physicalPage} 页` : `第 ${candidate.recordLine} 行`}`}
                                  aria-invalid={Boolean(selection.formState.errors.candidateIds)}
                                  checked={selected.includes(candidate.id)}
                                  disabled={
                                    pending ||
                                    !["available", "failed"].includes(candidate.status) ||
                                    (!selected.includes(candidate.id) &&
                                      selected.length >= maximumCatalogBatchRecords)
                                  }
                                  onCheckedChange={(checked) =>
                                    selection.setValue(
                                      "candidateIds",
                                      checked
                                        ? [...selected, candidate.id]
                                        : selected.filter((id) => id !== candidate.id),
                                      { shouldValidate: true, shouldDirty: true },
                                    )
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                {candidate.identifier}
                                {candidate.duplicateIdentifier && (
                                  <Badge variant="outline">重复编号</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {candidate.physicalPage ? `第 ${candidate.physicalPage} 页 · ` : ""}
                                第 {candidate.recordLine} 行
                              </TableCell>
                              <TableCell>
                                {candidateLabels[candidate.status]}
                                {candidate.attempts > 0 && ` · ${candidate.attempts} 次尝试`}
                                {candidate.failureCode && (
                                  <p className="text-sm text-muted-foreground">
                                    {failures[candidate.failureCode]}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell>
                                {candidate.productId && (
                                  <Button
                                    variant="link"
                                    size="sm"
                                    render={
                                      <Link
                                        href={workspaceRecordHref(
                                          projectId,
                                          "product",
                                          candidate.productId,
                                        )}
                                      />
                                    }
                                  >
                                    查看草稿
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                          {!filteredCandidates.length ? (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="py-6 text-center text-sm text-muted-foreground"
                              >
                                没有符合「{candidateQuery}」的目录记录。
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                      <FieldError errors={[selection.formState.errors.candidateIds]} />
                    </FieldSet>
                    <Button type="submit" disabled={pending || !selected.length || !choices.length}>
                      生成 {selected.length} 条待审核草稿
                    </Button>
                  </FieldGroup>
                </form>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>未识别到可选择的产品记录</EmptyTitle>
                    <EmptyDescription>
                      请检查目录中是否包含明确标注的产品编号，或使用单条智能导入核对资料。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ))}
          </>
        )}
      </CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground">
          导入结果需要人工核实；正式报价和交期仍需负责人确认。
        </p>
      </CardFooter>
    </Card>
  );
}
