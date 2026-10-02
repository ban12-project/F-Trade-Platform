"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { initialSalesActionState } from "@/lib/action-states";
import { submitRfqReadyAction } from "@/lib/actions/sales";
import { rfqReadyFormSchema } from "@/lib/form-schemas";
import { rfqMissingLabel } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";
import { useWorkspaceDirty } from "./dirty-state";

export function RfqReadyForm({ projectId, entry }: { projectId: string; entry: RfqEntry }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitRfqReadyAction, initialSalesActionState);
  const form = useForm<z.infer<typeof rfqReadyFormSchema>>({
    resolver: zodResolver(rfqReadyFormSchema),
    defaultValues: { projectId, rfqId: entry.id, evidenceRef: "" },
  });
  useWorkspaceDirty(`rfq-ready-${entry.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset();
      router.refresh();
    }
  }, [form, router, state]);
  if (entry.state === "RFQ_READY")
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>需求已确认完整</AlertTitle>
        <AlertDescription>可以由人工销售处理报价，报价仍需单独审核和登记发送。</AlertDescription>
      </Alert>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>确认需求完整</CardTitle>
        <CardDescription>
          {entry.missingFields.length
            ? `还需补充：${entry.missingFields.map(rfqMissingLabel).join("、")}`
            : "核对产品身份、数量和目的地后，确认交给人工销售报价。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={`rfq-ready-${entry.id}`}
          onSubmit={form.handleSubmit((values) => {
            const data = new FormData();
            for (const [key, value] of Object.entries(values))
              if (value !== undefined) data.set(key, value);
            startTransition(() => action(data));
          })}
        >
          <Field data-invalid={!!form.formState.errors.evidenceRef}>
            <FieldLabel htmlFor={`ready-${entry.id}`}>完整性确认凭据</FieldLabel>
            <Input
              id={`ready-${entry.id}`}
              {...form.register("evidenceRef")}
              aria-invalid={!!form.formState.errors.evidenceRef}
            />
            <FieldError errors={[form.formState.errors.evidenceRef]} />
          </Field>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          type="submit"
          form={`rfq-ready-${entry.id}`}
          disabled={pending || entry.missingFields.length > 0}
        >
          <ShieldCheckIcon data-icon="inline-start" />
          确认需求完整
        </Button>
        {state.message ? (
          <p
            role="status"
            className={
              state.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {state.message}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  );
}
