"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { Controller, useForm, useFormState, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type ProductIntakeModelOption, productIntakeModelChoices } from "@/lib/ai/model-choices";
import { documentUploadFormSchema } from "@/lib/product/document-upload-contracts";
import type { EvidenceOption } from "@/lib/workspace/access";
import { useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";
import { FileDropzone } from "./file-dropzone";
import { ProductAgentForm } from "./product-agent-form";
import { ProductDraftForm } from "./product-draft-form";
import { EvidenceLibrary } from "./product-evidence-library";
import { WorkspacePanelSkeleton } from "./workspace-loading-skeleton";

const ProductCatalogImport = dynamic(
  () => import("./product-catalog-import").then((module) => module.ProductCatalogImport),
  { loading: () => <WorkspacePanelSkeleton label="正在加载目录导入" /> },
);

const EMPTY_FILES: File[] = [];

export function ProductIntakePanel({
  projectId,
  canReview,
  agentModelConfigs,
  evidenceOptions = [],
}: {
  projectId: string;
  canReview: boolean;
  agentModelConfigs: ProductIntakeModelOption[];
  evidenceOptions?: EvidenceOption[];
}) {
  const modelChoices = useMemo(
    () => productIntakeModelChoices(agentModelConfigs),
    [agentModelConfigs],
  );
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { requestNavigation } = useWorkspaceDirtyState();
  const intakeForm = useForm<z.infer<typeof documentUploadFormSchema>>({
    resolver: zodResolver(documentUploadFormSchema),
  });
  const file = useWatch({ control: intakeForm.control, name: "document" });
  const intakeReady = intakeForm.formState.isReady;
  const { errors: intakeErrors } = useFormState({
    control: intakeForm.control,
  });
  const intakeFileRef = useRef<HTMLInputElement | null>(null);
  const clearFile = useCallback(() => {
    intakeForm.reset();
    if (intakeFileRef.current) intakeFileRef.current.value = "";
  }, [intakeForm]);
  const [draftDirty, setDraftDirty] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const dropzoneFiles = useMemo(() => (file ? [file] : EMPTY_FILES), [file]);
  const sharedSource = useMemo(() => ({ file, clear: clearFile }), [file, clearFile]);
  useWorkspaceDirty("product-intake-file", !!file);
  const requestedMethod = searchParams.get("method");
  const tab =
    requestedMethod === "manual" || requestedMethod === "catalog" ? requestedMethod : "agent";
  function setTab(value: string) {
    const query = new URLSearchParams(searchParams.toString());
    query.set("method", value);
    const navigate = () => {
      if (value === "manual") clearFile();
      window.history.pushState(null, "", `${pathname}?${query}`);
    };
    if (draftDirty || value === "manual" || tab === "manual") requestNavigation(navigate);
    else navigate();
  }
  const describedBy = [
    "product-source-file-help",
    file ? "product-source-file-selection" : undefined,
    intakeErrors.document ? "product-source-file-error" : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">导入产品资料</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          拖入获授权的工厂资料即可开始，支持单品 AI
          抽取、整本目录批量导入与手动录入。草稿需经人工核实后才能用于内容制作。
        </p>
      </div>
      {tab !== "manual" ? (
        <Card>
          <CardHeader>
            <CardTitle>第一步：选择产品资料</CardTitle>
            <CardDescription>
              先拖入或选择文件，再决定按单个产品直接抽取，还是先扫描整本产品目录。文件会自动保存到项目资料库。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={!!intakeErrors.document}>
                <FieldLabel htmlFor="product-source-file">产品资料</FieldLabel>
                <Controller
                  control={intakeForm.control}
                  name="document"
                  render={({ field }) => (
                    <FileDropzone
                      id="product-source-file"
                      name={field.name}
                      inputRef={(element) => {
                        field.ref(element);
                        intakeFileRef.current = element;
                      }}
                      onBlur={field.onBlur}
                      accept=".pdf,.csv,.xls,.xlsx"
                      disabled={importBusy || !intakeReady}
                      invalid={!!intakeErrors.document}
                      describedBy={describedBy}
                      files={dropzoneFiles}
                      emptyTitle="拖拽工厂 PDF / CSV / Excel 到这里，或点击选择"
                      emptyDescription="同一份文件可直接用于下方的单个产品或产品目录导入"
                      onFilesChange={(files) => {
                        const selected = files[0];
                        field.onChange(selected);
                        if (selected) void intakeForm.trigger("document");
                        else intakeForm.clearErrors("document");
                      }}
                    />
                  )}
                />
                <FieldDescription id="product-source-file-help">
                  支持 PDF、CSV 和 Excel，最大 25 MB。
                </FieldDescription>
                {file ? (
                  <FieldDescription id="product-source-file-selection" className="break-all">
                    已选择：{file.name}
                  </FieldDescription>
                ) : null}
                <FieldError id="product-source-file-error" errors={[intakeErrors.document]} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full" aria-label="资料录入方式">
          <TabsTrigger value="agent" disabled={importBusy}>
            单个产品
          </TabsTrigger>
          <TabsTrigger value="catalog" disabled={importBusy}>
            产品目录
          </TabsTrigger>
          <TabsTrigger value="manual" disabled={importBusy}>
            手动录入
          </TabsTrigger>
        </TabsList>
        <TabsContent value="agent">
          <ProductAgentForm
            source={sharedSource}
            onDraftDirty={setDraftDirty}
            onBusyChange={setImportBusy}
            canStream={canReview}
            projectId={projectId}
            modelChoices={modelChoices}
            evidenceOptions={evidenceOptions}
          />
        </TabsContent>
        <TabsContent value="manual" className="flex flex-col gap-4">
          <EvidenceLibrary projectId={projectId} evidenceOptions={evidenceOptions} />
          <ProductDraftForm projectId={projectId} evidenceOptions={evidenceOptions} />
        </TabsContent>
        <TabsContent value="catalog">
          <ProductCatalogImport
            source={sharedSource}
            onDraftDirty={setDraftDirty}
            onBusyChange={setImportBusy}
            key={projectId}
            projectId={projectId}
            modelChoices={modelChoices}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
