"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { changeWorkspaceProjectNameAction } from "@/lib/actions/workspace";
import { workspaceProjectNameChangeSchema } from "@/lib/workspace/contracts";
import { useWorkspaceDirty } from "./dirty-state";
export function ProjectNameForm({ projectId, title }: { projectId: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const form = useForm<z.infer<typeof workspaceProjectNameChangeSchema>>({
    resolver: zodResolver(workspaceProjectNameChangeSchema),
    defaultValues: { projectId, title },
  });
  useWorkspaceDirty(`project-name:${projectId}`, form.formState.isDirty);
  return (
    <form
      className="flex max-w-lg flex-col gap-3"
      onSubmit={form.handleSubmit((values) =>
        startTransition(async () => {
          const result = await changeWorkspaceProjectNameAction(values);
          setMessage(result.message);
          if (result.status === "success") {
            form.reset(values);
            router.refresh();
          }
        }),
      )}
    >
      <Field data-invalid={!!form.formState.errors.title}>
        <FieldLabel htmlFor="project-name">项目名称</FieldLabel>
        <Controller
          control={form.control}
          name="title"
          render={({ field }) => (
            <Input id="project-name" disabled={!form.formState.isReady || pending} {...field} />
          )}
        />
        <FieldError errors={[form.formState.errors.title]} />
      </Field>
      <Button
        disabled={pending || !form.formState.isReady || !form.formState.isDirty}
        type="submit"
      >
        {pending ? "保存中…" : "保存名称"}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </form>
  );
}
