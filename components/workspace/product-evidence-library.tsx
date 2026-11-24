"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileUpIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { initialProductEvidenceActionState } from "@/lib/action-states";
import { uploadProductEvidenceAction } from "@/lib/actions/product-evidence";
import { documentUploadFormSchema } from "@/lib/product/document-upload-contracts";
import { uploadProductDocument } from "@/lib/product/upload-document-client";
import type { EvidenceOption } from "@/lib/workspace/access";

import { useWorkspaceDirty } from "./dirty-state";

export function EvidenceLibrary({
  projectId,
  evidenceOptions,
  onUploaded,
  onDraftDirty,
  onBusyChange,
}: {
  projectId: string;
  evidenceOptions: EvidenceOption[];
  onUploaded?: (evidenceId?: string) => void;
  onDraftDirty?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const fileId = useId();
  const uploadForm = useRef<HTMLFormElement>(null);
  const [showResult, setShowResult] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: typeof initialProductEvidenceActionState, file: File) => {
      try {
        const receiptId = await uploadProductDocument(file, projectId, "evidence");
        const data = new FormData();
        data.set("projectId", projectId);
        data.set("receiptId", receiptId);
        const result = await uploadProductEvidenceAction(previous, data);
        if (result.status === "success") onUploaded?.(result.evidenceId);
        return result;
      } catch {
        return { status: "error" as const, message: "文件上传失败，请检查文件与项目权限后重试。" };
      }
    },
    initialProductEvidenceActionState,
  );
  const form = useForm<z.infer<typeof documentUploadFormSchema>>({
    resolver: zodResolver(documentUploadFormSchema),
  });
  const document = useWatch({ control: form.control, name: "document" });
  const dirty = Boolean(document) || pending;
  const busy = !form.formState.isReady || pending;
  useWorkspaceDirty("evidence-upload", dirty);
  useEffect(() => {
    onDraftDirty?.(dirty);
    return () => onDraftDirty?.(false);
  }, [dirty, onDraftDirty]);
  useEffect(() => {
    onBusyChange?.(pending);
    return () => onBusyChange?.(false);
  }, [pending, onBusyChange]);
  useEffect(() => {
    if (state.status === "success") {
      form.reset();
      uploadForm.current?.reset();
      router.refresh();
    }
  }, [form, router, state]);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>项目资料库</CardTitle>
        <CardDescription>
          上传工厂资料或授权证明，供录入和审核时选择。上传后仍需核实资料内容。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={uploadForm}
          onSubmit={(event) => {
            event.stopPropagation();
            void form.handleSubmit(({ document }) => {
              if (busy) return;
              setShowResult(true);
              startTransition(() => action(document));
            })(event);
          }}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(form.formState.errors.document)}>
              <FieldLabel htmlFor={fileId}>资料文件</FieldLabel>
              <Controller
                control={form.control}
                name="document"
                render={({ field }) => (
                  <Input
                    id={fileId}
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    type="file"
                    accept=".pdf,.csv,.xls,.xlsx"
                    required
                    disabled={busy}
                    aria-invalid={Boolean(form.formState.errors.document)}
                    aria-describedby={[
                      `${fileId}-help`,
                      form.formState.errors.document ? `${fileId}-error` : undefined,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onChange={(event) => {
                      setShowResult(false);
                      field.onChange(event.target.files?.[0]);
                    }}
                  />
                )}
              />
              <FieldDescription id={`${fileId}-help`}>
                支持 PDF、CSV、XLS、XLSX，最大 25 MB；文件保存在私有存储。
              </FieldDescription>
              <FieldError id={`${fileId}-error`} errors={[form.formState.errors.document]} />
            </Field>
            <Button type="submit" variant="outline" className="min-h-11 w-full" disabled={busy}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileUpIcon data-icon="inline-start" />
              )}
              {pending ? "正在上传并保存资料…" : "保存到项目资料库"}
            </Button>
            {pending ? (
              <p role="status" className="text-sm text-muted-foreground">
                正在上传并保存，请等待结果。关闭窗口不会取消已提交的保存。
              </p>
            ) : null}
            {showResult && !pending && state.message ? (
              <p
                aria-live="polite"
                className={
                  state.status === "error"
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {state.message}
              </p>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <span className="text-xs text-muted-foreground">
          当前可用 {evidenceOptions.length} 份资料
        </span>
      </CardFooter>
    </Card>
  );
}
