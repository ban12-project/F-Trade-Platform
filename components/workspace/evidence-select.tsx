"use client";

import { createContext, useContext, useId, useState, useTransition } from "react";
import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldDescription } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listEvidenceOptionsAction } from "@/lib/actions/evidence-options";
import { EvidenceLibrary } from "./product-evidence-library";

export type EvidenceChoice = { id: string; label: string; detail?: string };

const EvidenceChoicesContext = createContext<EvidenceChoice[] | undefined>(undefined);
export function EvidenceChoicesProvider({
  options,
  children,
}: {
  options: EvidenceChoice[];
  children: React.ReactNode;
}) {
  return <EvidenceChoicesContext value={options}>{children}</EvidenceChoicesContext>;
}

export function EvidenceSelect({
  projectId,
  id,
  value,
  onValueChange,
  onBlur,
  inputRef,
  invalid,
  disabled,
  videoId,
  options: initialOptions,
}: {
  projectId: string;
  videoId?: string;
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLButtonElement>;
  invalid?: boolean;
  disabled?: boolean;
  options?: EvidenceChoice[];
}) {
  const sharedOptions = useContext(EvidenceChoicesContext);
  const descriptionId = useId();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [result, setResult] = useState<{ options: EvidenceChoice[]; error: string } | null>(
    initialOptions || sharedOptions
      ? { options: initialOptions ?? sharedOptions ?? [], error: "" }
      : null,
  );
  const [pending, startTransition] = useTransition();
  const options = result?.options ?? [];
  const labels = options.map((option, index) =>
    options.some((other) => other.id !== option.id && other.label === option.label)
      ? `${option.label} · ${option.detail ?? "资料"} · ${index + 1}`
      : option.label,
  );
  const selectedLabel = labels[options.findIndex((option) => option.id === value)];
  function refresh() {
    startTransition(async () => {
      try {
        setResult(await listEvidenceOptionsAction({ projectId, ...(videoId ? { videoId } : {}) }));
      } catch {
        setResult({ options: [], error: "资料加载失败，请重试。" });
      }
    });
  }
  return (
    <>
      <Select
        value={value || null}
        disabled={disabled}
        onValueChange={(next) => onValueChange(next ?? "")}
        onOpenChange={(open) => {
          if (open && !result && !pending) refresh();
        }}
      >
        <SelectTrigger
          id={id}
          ref={inputRef}
          onBlur={onBlur}
          aria-invalid={invalid}
          aria-describedby={descriptionId}
          className="w-full"
        >
          <SelectValue placeholder="请选择已保存的资料">
            {selectedLabel ?? (value ? "请重新选择资料" : undefined)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option, index) => (
              <SelectItem key={option.id} value={option.id} data-evidence-id={option.id}>
                {labels[index]}
              </SelectItem>
            ))}
            {!options.length ? (
              <SelectItem value="__empty" disabled>
                {pending ? "正在加载资料…" : result?.error ? "暂时无法加载资料" : "暂无可选资料"}
              </SelectItem>
            ) : null}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription id={descriptionId} aria-live="polite">
        {result?.error ||
          (result && !options.length
            ? "暂无可用资料，请上传文件后选择。"
            : "请选择与本次操作对应的文件。")}
      </FieldDescription>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || pending}
        onClick={refresh}
      >
        {pending ? "正在加载…" : "刷新资料列表"}
      </Button>
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogTrigger
          render={<Button type="button" variant="outline" size="sm" disabled={disabled} />}
        >
          上传资料
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加来源资料</DialogTitle>
          </DialogHeader>
          {uploadOpen ? (
            <EvidenceLibrary
              projectId={projectId}
              evidenceOptions={[]}
              onUploaded={() => {
                setUploadOpen(false);
                refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EvidenceSelectField<T extends FieldValues>({
  control,
  name,
  ...props
}: {
  control: Control<T>;
  name: FieldPath<T>;
} & Omit<
  React.ComponentProps<typeof EvidenceSelect>,
  "value" | "onValueChange" | "onBlur" | "inputRef"
>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <EvidenceSelect
          {...props}
          value={field.value ?? ""}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          inputRef={field.ref}
          invalid={fieldState.invalid}
        />
      )}
    />
  );
}
