"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { EvidenceSelect, EvidenceSelectField } from "@/components/workspace/evidence-select";

const schema = z.object({ evidenceRef: z.string().min(1, "请选择授权证明。") });
const projectId = "00000000-0000-4000-8000-000000000760";
export function EvidenceSelectFixture() {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { evidenceRef: "" },
  });
  const [saved, setSaved] = useState("");
  return (
    <FieldGroup>
      <form onSubmit={form.handleSubmit(({ evidenceRef }) => setSaved(evidenceRef))}>
        <Field data-invalid={!!form.formState.errors.evidenceRef}>
          <FieldLabel htmlFor="rights">素材使用授权证明</FieldLabel>
          <EvidenceSelectField
            projectId={projectId}
            control={form.control}
            name="evidenceRef"
            id="rights"
            options={[
              {
                id: "evidence-synthetic-rights-760",
                label: "合成工厂授权书.pdf",
                detail: "2026-10-01",
              },
              {
                id: "evidence-synthetic-rights-761",
                label: "合成工厂授权书.pdf",
                detail: "2026-10-02",
              },
            ]}
          />
          <FieldError errors={[form.formState.errors.evidenceRef]} />
        </Field>
        <Button type="submit">保存选择</Button>
        <Button type="button" onClick={() => form.reset()}>
          清空选择
        </Button>
        <output aria-label="提交结果">{saved}</output>
      </form>
      <Field>
        <FieldLabel htmlFor="empty">空资料库</FieldLabel>
        <EvidenceSelect
          projectId={projectId}
          id="empty"
          value=""
          onValueChange={() => {}}
          options={[]}
        />
      </Field>
    </FieldGroup>
  );
}
