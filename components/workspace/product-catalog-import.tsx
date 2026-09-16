"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

const failures: Record<CatalogFailureCode, string> = {
  SOURCE_UNAVAILABLE: "无法读取或核验原件，请重新上传。",
  PREPROCESS_FAILED: "目录解析失败，可重试或更换可提取文字的文件。",
  MODEL_FAILED: "抽取未通过，请检查模型配置后重试。",
  MODEL_CONFIG_UNAVAILABLE: "模型配置不可用，请在账号与工具中检查配置。",
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
  onOpenDraft,
}: {
  projectId: string;
  modelConfigs: ProductAgentModelSettings[];
  onOpenDraft: () => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<CatalogImportView | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
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
  const selected = useWatch({ control: selection.control, name: "candidateIds" });
  const modelConfigId = useWatch({ control: selection.control, name: "modelConfigId" });
  const model = useWatch({ control: selection.control, name: "model" });
  const working = Boolean(isWorking(view));

  useEffect(() => {
    let cancelled = false;
    void getLatestProductCatalogAction(projectId)
      .then((result) => {
        if (cancelled) return;
        if (result.status === "success") setView(result.view);
        else setError(result.message);
        setRestoring(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("无法恢复目录任务，请刷新后重试。");
          setRestoring(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!view || !working) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void getProductCatalogAction({ projectId, importId: view.id })
        .then((result) => {
          if (cancelled) return;
          if (result.status === "success") {
            setView(result.view);
            if (!isWorking(result.view)) router.refresh();
          } else setError(result.message);
        })
        .catch(() => {
          if (!cancelled) setError("进度读取失败，请点击刷新进度。");
        });
    }, 2_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, working, projectId, router]);

  function accept(result: CatalogActionResult) {
    if (result.status === "error") {
      setError(result.message);
      return false;
    }
    setView(result.view);
    setError("");
    return true;
  }

  async function upload(values: z.infer<typeof documentUploadFormSchema>) {
    setPending(true);
    setError("");
    try {
      const receiptId = await uploadProductDocument(values.document, projectId, "agent");
      if (accept(await intakeProductCatalogAction({ projectId, receiptId }))) {
        uploadForm.reset();
        selection.setValue("candidateIds", []);
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch {
      setError("上传失败，请检查文件大小、网络及项目权限后重试。");
    } finally {
      setPending(false);
    }
  }

  async function submit(values: CatalogSelection) {
    setPending(true);
    setError("");
    try {
      if (accept(await selectProductCatalogAction(values))) selection.setValue("candidateIds", []);
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
      accept(await (retry ? retryProductCatalogAction(input) : getProductCatalogAction(input)));
    } catch {
      setError("无法更新目录任务，请重试。");
    } finally {
      setPending(false);
    }
  }

  const available =
    view?.candidates.filter(
      (candidate) => candidate.status === "available" || candidate.status === "failed",
    ) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>目录批量导入</CardTitle>
        <CardDescription>
          上传目录后选择记录，每批最多 20 条。每条草稿独立保留来源位置，须经人工审核。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={uploadForm.handleSubmit(upload)}>
          <FieldGroup>
            <Field data-invalid={Boolean(uploadForm.formState.errors.document)}>
              <FieldLabel htmlFor="catalog-document">产品目录文件</FieldLabel>
              <Input
                id="catalog-document"
                ref={fileRef}
                type="file"
                accept=".pdf,.csv,.xls,.xlsx"
                disabled={pending || restoring || working}
                aria-invalid={Boolean(uploadForm.formState.errors.document)}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadForm.setValue("document", file, { shouldValidate: true });
                  else uploadForm.resetField("document");
                }}
              />
              <FieldDescription>
                支持 PDF、CSV 和 Excel，最大 25 MiB。解析进度可在刷新后恢复。
              </FieldDescription>
              <FieldError errors={[uploadForm.formState.errors.document]} />
            </Field>
            <Button type="submit" disabled={pending || restoring || working}>
              {pending ? "提交中…" : "上传并解析目录"}
            </Button>
          </FieldGroup>
        </form>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {restoring && <p role="status">正在恢复目录任务…</p>}
        {view && (
          <>
            <div className="flex flex-wrap items-center gap-2" role="status">
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
              {view.status === "failed" && (
                <Button size="sm" disabled={pending} onClick={() => void update(true)}>
                  重试解析
                </Button>
              )}
            </div>
            {view.failureCode && (
              <Alert>
                <AlertDescription>{failures[view.failureCode]}</AlertDescription>
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
                          const choice = choices.find((item) => item.value === event.target.value);
                          if (choice) {
                            selection.setValue("modelConfigId", choice.configId, {
                              shouldValidate: true,
                            });
                            selection.setValue("model", choice.model, { shouldValidate: true });
                          }
                        }}
                      >
                        {!choices.length && (
                          <NativeSelectOption value={JSON.stringify(["", ""])}>
                            请先在账号与工具配置模型
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
                    <FieldSet>
                      <FieldLegend>
                        选择目录记录（已选 {selected.length}/{maximumCatalogBatchRecords}）
                      </FieldLegend>
                      <FieldDescription>
                        相同编号的不同页记录须分别核对。失败项可再次选择，已完成草稿不会重复生成。
                      </FieldDescription>
                      <div className="flex flex-wrap gap-2">
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
                              { shouldValidate: true },
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
                            selection.setValue("candidateIds", [], { shouldValidate: true })
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
                              { shouldValidate: true },
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
                          {view.candidates.map((candidate) => (
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
                                      { shouldValidate: true },
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
                                        onClick={onOpenDraft}
                                        href={`/workspace/${projectId}?panel=product&item=${candidate.productId}`}
                                      />
                                    }
                                  >
                                    查看草稿
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
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
          目录抽取不会确认工程事实、报价或交期，也不会自动通过 Gate 01。
        </p>
      </CardFooter>
    </Card>
  );
}
