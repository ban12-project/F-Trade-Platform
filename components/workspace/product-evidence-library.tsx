"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileUpIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId } from "react";
import { Controller, useForm } from "react-hook-form";
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

export function EvidenceLibrary({
  projectId,
  evidenceOptions,
  onUploaded,
}: {
  projectId: string;
  evidenceOptions: EvidenceOption[];
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const fileId = useId();
  const [state, action, pending] = useActionState(
    async (previous: typeof initialProductEvidenceActionState, file: File) => {
      try {
        const receiptId = await uploadProductDocument(file, projectId, "evidence");
        const data = new FormData();
        data.set("projectId", projectId);
        data.set("receiptId", receiptId);
        const result = await uploadProductEvidenceAction(previous, data);
        if (result.status === "success") onUploaded?.();
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
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state]);
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
          onSubmit={(event) => {
            event.stopPropagation();
            void form.handleSubmit(({ document }) => startTransition(() => action(document)))(
              event,
            );
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
                    disabled={pending}
                    aria-invalid={Boolean(form.formState.errors.document)}
                    onChange={(event) => field.onChange(event.target.files?.[0])}
                  />
                )}
              />
              <FieldDescription>
                支持 PDF、CSV、XLS、XLSX，最大 25 MiB；文件保存在私有存储。
              </FieldDescription>
              <FieldError errors={[form.formState.errors.document]} />
            </Field>
            <Button type="submit" variant="outline" className="min-h-11 w-full" disabled={pending}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileUpIcon data-icon="inline-start" />
              )}
              保存到项目资料库
            </Button>
            {state.message ? (
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
