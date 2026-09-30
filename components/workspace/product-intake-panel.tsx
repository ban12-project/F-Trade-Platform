"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { documentUploadFormSchema } from "@/lib/product/document-upload-contracts";
import type { EvidenceOption } from "@/lib/workspace/access";
import { useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";
import { ProductAgentForm } from "./product-agent-form";
import { ProductCatalogImport } from "./product-catalog-import";
import { ProductDraftForm } from "./product-draft-form";
import { EvidenceLibrary } from "./product-evidence-library";
export function ProductIntakePanel({
  projectId,
  canReview,
  agentModelConfigs,
  evidenceOptions = [],
}: {
  projectId: string;
  canReview: boolean;
  agentModelConfigs: ProductAgentModelSettings[];
  evidenceOptions?: EvidenceOption[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { requestNavigation } = useWorkspaceDirtyState();
  const intakeForm = useForm<z.infer<typeof documentUploadFormSchema>>({
    resolver: zodResolver(documentUploadFormSchema),
  });
  const file = intakeForm.watch("document");
  const intakeFileRef = useRef<HTMLInputElement | null>(null);
  const clearFile = useCallback(() => {
    intakeForm.reset();
    if (intakeFileRef.current) intakeFileRef.current.value = "";
  }, [intakeForm]);
  const [draftDirty, setDraftDirty] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
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
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">导入产品资料</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          从获授权的工厂资料开始。导入结果会保存为草稿，由人工核实后用于内容制作。
        </p>
      </div>
      {tab !== "manual" ? (
        <Card>
          <CardHeader>
            <CardTitle>选择产品资料</CardTitle>
            <CardDescription>
              先选择文件，再确认是单个产品资料还是包含多个产品的目录。文件会随导入自动保存为证据。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={!!intakeForm.formState.errors.document}>
                <FieldLabel htmlFor="product-source-file">产品资料</FieldLabel>
                <Controller
                  control={intakeForm.control}
                  name="document"
                  render={({ field }) => (
                    <Input
                      id="product-source-file"
                      disabled={importBusy || !intakeForm.formState.isReady}
                      type="file"
                      accept=".pdf,.csv,.xls,.xlsx"
                      ref={(element) => {
                        field.ref(element);
                        intakeFileRef.current = element;
                      }}
                      onBlur={field.onBlur}
                      onChange={(event) => {
                        field.onChange(event.target.files?.[0]);
                        void intakeForm.trigger("document");
                      }}
                    />
                  )}
                />
                <FieldDescription>
                  {file ? `已选择：${file.name}` : "支持 PDF、CSV 和 Excel，最大 25 MiB。"}
                </FieldDescription>
                <FieldError errors={[intakeForm.formState.errors.document]} />
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
            source={{ file, clear: clearFile }}
            onDraftDirty={setDraftDirty}
            onBusyChange={setImportBusy}
            canStream={canReview}
            projectId={projectId}
            modelConfigs={agentModelConfigs}
            evidenceOptions={evidenceOptions}
          />
        </TabsContent>
        <TabsContent value="manual" className="flex flex-col gap-4">
          <EvidenceLibrary projectId={projectId} evidenceOptions={evidenceOptions} />
          <ProductDraftForm projectId={projectId} evidenceOptions={evidenceOptions} />
        </TabsContent>
        <TabsContent value="catalog">
          <ProductCatalogImport
            source={{ file, clear: clearFile }}
            onDraftDirty={setDraftDirty}
            onBusyChange={setImportBusy}
            key={projectId}
            projectId={projectId}
            modelConfigs={agentModelConfigs}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
