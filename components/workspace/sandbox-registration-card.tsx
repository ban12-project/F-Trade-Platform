"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { browserNodeCommandAction } from "@/lib/actions/browser-nodes";
import { sandboxNodeFormSchema } from "@/lib/browser-fleet/contracts";

export function SandboxRegistrationCard({
  enabled,
  onCreated,
}: {
  enabled: boolean;
  onCreated?: () => Promise<void>;
}) {
  const formId = useId();
  const [message, setMessage] = useState("");
  const form = useForm<z.infer<typeof sandboxNodeFormSchema>>({
    resolver: zodResolver(sandboxNodeFormSchema),
    defaultValues: { name: "" },
  });
  const disabled = !enabled || form.formState.isSubmitting;
  return (
    <Card>
      <CardHeader>
        <CardTitle>创建托管浏览器</CardTitle>
        <CardDescription>
          {enabled
            ? "只需填写名称。创建后再添加账号，需要操作时启动，空闲后停止。"
            : "托管浏览器尚未启用，暂时无法创建。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={formId}
          onSubmit={form.handleSubmit(async (value) => {
            if (!enabled) return;
            setMessage("");
            try {
              const result = await browserNodeCommandAction({ operation: "create-sandbox", value });
              if (!result.ok) {
                setMessage(result.message);
                return;
              }
              form.reset();
              setMessage("托管节点已创建，尚未启动浏览器。请添加账号后按需打开。");
              try {
                await onCreated?.();
              } catch {
                setMessage("托管节点已创建，列表刷新失败，请刷新页面查看。");
              }
            } catch {
              setMessage("创建结果尚未确认，请先刷新列表核对，避免重复创建。");
            }
          })}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(form.formState.errors.name)} data-disabled={disabled}>
              <FieldLabel htmlFor={`${formId}-name`}>托管节点名称</FieldLabel>
              <Input
                id={`${formId}-name`}
                {...form.register("name")}
                disabled={disabled}
                aria-invalid={Boolean(form.formState.errors.name)}
                autoComplete="off"
              />
              <FieldError errors={[form.formState.errors.name]} />
            </Field>
          </FieldGroup>
        </form>
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      </CardContent>
      <CardFooter>
        <Button type="submit" form={formId} disabled={disabled}>
          {form.formState.isSubmitting ? "正在创建…" : "创建托管节点"}
        </Button>
      </CardFooter>
    </Card>
  );
}
